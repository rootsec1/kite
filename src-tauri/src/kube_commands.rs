use std::{collections::BTreeMap, env, path::PathBuf};

use k8s_openapi::api::{
    apps::v1::{DaemonSet, Deployment, ReplicaSet, StatefulSet},
    autoscaling::v2::HorizontalPodAutoscaler,
    batch::v1::{CronJob, Job},
    core::v1::{
        ConfigMap, ContainerStatus, EnvFromSource, EnvVar, Event, Namespace, Node, PersistentVolume,
        PersistentVolumeClaim, Pod, Secret, Service, ServiceAccount,
    },
    discovery::v1::{Endpoint, EndpointSlice},
    networking::v1::{Ingress, NetworkPolicy},
    rbac::v1::{ClusterRole, ClusterRoleBinding, Role, RoleBinding, Subject},
    storage::v1::StorageClass,
};
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::CustomResourceDefinition;
use kube::{
    api::ListParams,
    config::{Config, KubeConfigOptions, Kubeconfig},
    core::{ApiResource, DynamicObject, GroupVersionKind},
    Api, Client, ResourceExt,
};
use serde::Deserialize;

use crate::models::{
    ActionPreview, ActionRisk, ActionTarget, ClusterSummary, ContainerDetails, ContainerProbe, HealthState, KubeContextSummary, LiveSnapshot,
    NamespaceHeat, PodActionResult, PodActionStatus, PodCondition, PodDetails, PodSchedulingDetails, ResourceDetails, ResourceEvent,
    ResourceReference, ResourceSummary,
};

#[derive(Debug, Deserialize)]
struct HelmRelease {
    #[serde(default)]
    name: String,
    #[serde(default)]
    namespace: String,
    #[serde(default)]
    revision: String,
    #[serde(default)]
    updated: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    chart: String,
    #[serde(default)]
    app_version: String,
}

#[tauri::command]
pub fn list_kube_contexts() -> Result<Vec<KubeContextSummary>, String> {
    let config = Kubeconfig::read().map_err(|error| format!("Unable to read kubeconfig: {error}"))?;
    let current_context = config.current_context.unwrap_or_default();

    Ok(config
        .contexts
        .into_iter()
        .filter_map(|entry| {
            let context = entry.context?;
            Some(KubeContextSummary {
                current: entry.name == current_context,
                name: entry.name,
                cluster: context.cluster,
                user: context.user.unwrap_or_default(),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn live_snapshot(context: Option<String>) -> Result<LiveSnapshot, String> {
    let started = std::time::Instant::now();
    let contexts = list_kube_contexts().unwrap_or_default();
    let context = selected_context_name(context, &contexts)?;
    let client = client_for_context(&context).await?;
    let version = client
        .apiserver_version()
        .await
        .map(|version| version.git_version)
        .unwrap_or_else(|_| "unknown".to_string());

    let (mut resources, namespaces) = required_snapshot_resources(client.clone(), &context).await?;
    let (gateway_resources, helm_releases) = tokio::join!(
        list_gateway_api_resources(client, &context),
        list_helm_releases(&context),
    );

    resources.extend(gateway_resources);
    resources.extend(helm_releases.unwrap_or_default());

    resources.sort_by(|left, right| {
        left.namespace
            .cmp(&right.namespace)
            .then(left.kind.cmp(&right.kind))
            .then(left.name.cmp(&right.name))
    });

    let warning_count = resources
        .iter()
        .filter(|resource| resource.status != HealthState::Healthy)
        .count();
    let provider = resources
        .iter()
        .find(|resource| resource.kind == "Node")
        .map(|_| "kube")
        .unwrap_or("kube")
        .to_string();

    Ok(LiveSnapshot {
        clusters: vec![ClusterSummary {
            id: context.clone(),
            name: context,
            region: "local".to_string(),
            provider,
            version,
            health: if warning_count > 0 {
                HealthState::Warning
            } else {
                HealthState::Healthy
            },
            latency_ms: started.elapsed().as_millis().min(u16::MAX as u128) as u16,
            namespaces: namespaces.len(),
            workloads: resources.len(),
            warnings: warning_count,
        }],
        namespace_heat: namespace_heat_for_namespaces(&namespaces, &resources),
        resources,
    })
}

async fn required_snapshot_resources(client: Client, context: &str) -> Result<(Vec<ResourceSummary>, Vec<String>), String> {
    let (pods, deployments, replicasets, statefulsets, daemonsets, jobs, cronjobs, hpas, services, endpoint_slices, ingresses) = tokio::try_join!(
        list_pods(client.clone(), context),
        list_deployments(client.clone(), context),
        list_replicasets(client.clone(), context),
        list_statefulsets(client.clone(), context),
        list_daemonsets(client.clone(), context),
        list_jobs(client.clone(), context),
        list_cronjobs(client.clone(), context),
        list_horizontal_pod_autoscalers(client.clone(), context),
        list_services(client.clone(), context),
        list_endpoint_slices(client.clone(), context),
        list_ingresses(client.clone(), context),
    )?;
    let (
        configmaps,
        secrets,
        service_accounts,
        persistent_volume_claims,
        persistent_volumes,
        storage_classes,
        roles,
        role_bindings,
        cluster_roles,
        cluster_role_bindings,
        network_policies,
        events,
        nodes,
        namespaces,
        crds,
    ) = tokio::join!(
        list_configmaps(client.clone(), context),
        list_secrets(client.clone(), context),
        list_service_accounts(client.clone(), context),
        list_persistent_volume_claims(client.clone(), context),
        list_persistent_volumes(client.clone(), context),
        list_storage_classes(client.clone(), context),
        list_roles(client.clone(), context),
        list_role_bindings(client.clone(), context),
        list_cluster_roles(client.clone(), context),
        list_cluster_role_bindings(client.clone(), context),
        list_network_policies(client.clone(), context),
        list_events(client.clone(), context),
        list_nodes(client.clone(), context),
        list_namespaces(client.clone(), context),
        list_crds(client, context),
    );
    let mut resources = Vec::new();

    resources.extend(pods);
    resources.extend(deployments);
    resources.extend(replicasets);
    resources.extend(statefulsets);
    resources.extend(daemonsets);
    resources.extend(jobs);
    resources.extend(cronjobs);
    resources.extend(hpas);
    resources.extend(services);
    resources.extend(endpoint_slices);
    resources.extend(ingresses);
    resources.extend(configmaps.unwrap_or_default());
    resources.extend(secrets.unwrap_or_default());
    resources.extend(service_accounts.unwrap_or_default());
    resources.extend(persistent_volume_claims.unwrap_or_default());
    resources.extend(persistent_volumes.unwrap_or_default());
    resources.extend(storage_classes.unwrap_or_default());
    resources.extend(roles.unwrap_or_default());
    resources.extend(role_bindings.unwrap_or_default());
    resources.extend(cluster_roles.unwrap_or_default());
    resources.extend(cluster_role_bindings.unwrap_or_default());
    resources.extend(network_policies.unwrap_or_default());
    resources.extend(events.unwrap_or_default());
    resources.extend(nodes.unwrap_or_default());
    resources.extend(namespaces.unwrap_or_default());
    resources.extend(crds.unwrap_or_default());
    annotate_warning_events(&mut resources);
    annotate_service_backends(&mut resources);
    let namespace_names = namespace_names_for(&resources);

    Ok((resources, namespace_names))
}

fn namespace_names_for(resources: &[ResourceSummary]) -> Vec<String> {
    let mut names = resources
        .iter()
        .filter_map(|resource| {
            if resource.kind == "Namespace" {
                Some(resource.name.as_str())
            } else if resource.namespace != "cluster" && !resource.namespace.is_empty() {
                Some(resource.namespace.as_str())
            } else {
                None
            }
        })
        .map(str::to_string)
        .collect::<Vec<_>>();

    names.sort();
    names.dedup();
    names
}

#[tauri::command]
pub fn guarded_action_preview(action: String, target: ActionTarget) -> ActionPreview {
    let normalized = action.to_lowercase();
    let risk = classify_action(&normalized);
    let requires_confirmation = matches!(risk, ActionRisk::Medium | ActionRisk::High);
    let message = if requires_confirmation {
        format!(
            "{} requires confirmation for {}/{} in namespace {} on {}.",
            action, target.kind, target.name, target.namespace, target.cluster
        )
    } else {
        format!(
            "{} can run for {}/{} in namespace {} on {}.",
            action, target.kind, target.name, target.namespace, target.cluster
        )
    };

    ActionPreview {
        action,
        risk,
        requires_confirmation,
        message,
    }
}

#[tauri::command]
pub async fn resource_details(target: ActionTarget) -> ResourceDetails {
    if target.kind == "HelmRelease" {
        return helm_details(target).await;
    }
    if target.kind == "Event" {
        return event_details(target).await;
    }

    let yaml = kubectl(resource_yaml_args(&target)).await.unwrap_or_else(|error| error);
    let describe = kubectl(resource_describe_args(&target)).await.unwrap_or_else(|error| error);
    let events = resource_events(&target).await.unwrap_or_default();
    let pod = if target.kind == "Pod" {
        pod_details(&target).await.ok()
    } else {
        None
    };
    let logs = if target.kind == "Pod" {
        pod_logs(&target, false).await.unwrap_or_else(|error| error)
    } else {
        String::new()
    };
    let previous_logs = if target.kind == "Pod" {
        pod_previous_logs(&target, pod.as_ref()).await.unwrap_or_default()
    } else {
        String::new()
    };

    ResourceDetails { yaml, describe, events, logs, previous_logs, pod }
}

async fn event_details(target: ActionTarget) -> ResourceDetails {
    let yaml = kubectl(resource_yaml_args(&target))
        .await
        .unwrap_or_else(|error| error);
    let describe = kubectl(resource_describe_args(&target))
        .await
        .unwrap_or_else(|error| error);
    let json = kubectl(resource_json_args(&target)).await.unwrap_or_default();

    event_resource_details(yaml, describe, &json)
}

fn event_resource_details(yaml: String, describe: String, json: &str) -> ResourceDetails {
    let events = serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .map(|event| vec![resource_event(&event)])
        .unwrap_or_default();

    ResourceDetails {
        yaml,
        describe,
        events,
        logs: String::new(),
        previous_logs: String::new(),
        pod: None,
    }
}

#[tauri::command]
pub async fn pod_action(action: String, target: ActionTarget, confirmed: bool) -> PodActionResult {
    let normalized = action.to_lowercase();
    let action_name = normalized.split_once(':').map(|(name, _)| name.to_string()).unwrap_or_else(|| normalized.clone());
    if target.kind != "Pod" {
        if action_name == "restart" && is_restartable_workload_kind(&target.kind) {
            let is_local = is_local_context(&target.cluster);
            return guarded_workload_restart(normalized, target, confirmed, is_local).await;
        }

        return pod_action_result(
            normalized,
            PodActionStatus::Blocked,
            "This action only runs against pods.".to_string(),
            String::new(),
            String::new(),
            false,
        );
    }

    let is_local = is_local_context(&target.cluster);
    match action_name.as_str() {
        "logs" => {
            let command = display_kubectl_command(&target, &[
                "logs".to_string(),
                target.name.clone(),
                "-n".to_string(),
                target.namespace.clone(),
                "--all-containers=true".to_string(),
                "--prefix=true".to_string(),
                "--tail=240".to_string(),
                "--timestamps".to_string(),
            ]);
            match pod_logs(&target, false).await {
                Ok(output) => pod_action_result(normalized, PodActionStatus::Executed, "Read latest pod logs.".to_string(), output, command, false),
                Err(error) => pod_action_result(normalized, PodActionStatus::Failed, error, String::new(), command, false),
            }
        }
        "exec" => {
            let container = match requested_container_for_exec_action(&normalized) {
                Ok(container) => container,
                Err(error) => {
                    return pod_action_result(normalized, PodActionStatus::Blocked, error, String::new(), String::new(), false);
                }
            };
            let command = pod_exec_command(&target, container.as_deref());
            match open_terminal(&command).await {
                Ok(()) => pod_action_result(
                    normalized,
                    PodActionStatus::Executed,
                    exec_opened_message(container.as_deref()),
                    String::new(),
                    command,
                    false,
                ),
                Err(error) => pod_action_result(
                    normalized,
                    PodActionStatus::Ready,
                    error,
                    String::new(),
                    command,
                    false,
                ),
            }
        }
        "port-forward" => {
            let port = match requested_port_for_action(&normalized) {
                Ok(Some(port)) => Ok(port),
                Ok(None) => first_pod_port(&target).await,
                Err(error) => Err(error),
            };

            match port {
                Ok(port) => {
                    let command = pod_port_forward_command(&target, port);
                    match open_terminal(&command).await {
                        Ok(()) => pod_action_result(
                            normalized,
                            PodActionStatus::Executed,
                            format!("Opened Terminal forwarding to pod port {port}."),
                            String::new(),
                            command,
                            false,
                        ),
                        Err(error) => pod_action_result(
                            normalized,
                            PodActionStatus::Ready,
                            error,
                            String::new(),
                            command,
                            false,
                        ),
                    }
                }
                Err(error) => pod_action_result(normalized, PodActionStatus::Blocked, error, String::new(), String::new(), false),
            }
        }
        "restart" => guarded_pod_write(normalized, target, confirmed, is_local).await,
        "delete" | "kill" => guarded_pod_write("delete".to_string(), target, confirmed, is_local).await,
        _ => pod_action_result(
            normalized,
            PodActionStatus::Blocked,
            "Unsupported pod action.".to_string(),
            String::new(),
            String::new(),
            false,
        ),
    }
}

fn requested_port_for_action(action: &str) -> Result<Option<u16>, String> {
    let Some((name, port)) = action.split_once(':') else {
        return Ok(None);
    };
    if name != "port-forward" {
        return Ok(None);
    }

    port.parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .map(Some)
        .ok_or_else(|| format!("Invalid pod port for {action}."))
}

fn requested_container_for_exec_action(action: &str) -> Result<Option<String>, String> {
    let Some((name, container)) = action.split_once(':') else {
        return Ok(None);
    };
    if name != "exec" {
        return Ok(None);
    }

    let container = container.trim();
    if container.is_empty() {
        return Err("Exec requires a non-empty container name.".to_string());
    }

    Ok(Some(container.to_string()))
}

fn exec_opened_message(container: Option<&str>) -> String {
    container
        .map(|container| format!("Opened Terminal with an interactive shell in container {container}."))
        .unwrap_or_else(|| "Opened Terminal with an interactive pod shell.".to_string())
}

async fn helm_details(target: ActionTarget) -> ResourceDetails {
    let manifest = command_output(
        "helm",
        helm_target_args(
            &target,
            vec![
                "get".to_string(),
                "manifest".to_string(),
                target.name.clone(),
                "-n".to_string(),
                target.namespace.clone(),
            ],
        ),
    )
    .await
    .unwrap_or_else(|error| error);
    let values = command_output(
        "helm",
        helm_target_args(
            &target,
            vec![
                "get".to_string(),
                "values".to_string(),
                target.name.clone(),
                "-n".to_string(),
                target.namespace.clone(),
                "-o".to_string(),
                "yaml".to_string(),
            ],
        ),
    )
    .await
    .unwrap_or_default();
    let status = command_output(
        "helm",
        helm_target_args(
            &target,
            vec![
                "status".to_string(),
                target.name.clone(),
                "-n".to_string(),
                target.namespace.clone(),
            ],
        ),
    )
    .await
    .unwrap_or_default();

    ResourceDetails {
        yaml: format!("{manifest}\n---\n# values\n{values}"),
        describe: status.clone(),
        events: if status.is_empty() {
            Vec::new()
        } else {
            vec![ResourceEvent {
                type_: "Normal".to_string(),
                reason: "HelmStatus".to_string(),
                message: status,
                age: "live".to_string(),
                count: 1,
            }]
        },
        logs: String::new(),
        previous_logs: String::new(),
        pod: None,
    }
}

async fn pod_logs(target: &ActionTarget, previous: bool) -> Result<String, String> {
    let mut args = vec![
        "logs".to_string(),
        target.name.clone(),
        "-n".to_string(),
        target.namespace.clone(),
        "--all-containers=true".to_string(),
        "--prefix=true".to_string(),
        "--tail=240".to_string(),
        "--timestamps".to_string(),
    ];
    if previous {
        args.push("--previous=true".to_string());
    }

    kubectl(kubectl_target_args(target, args)).await
}

async fn pod_previous_logs(target: &ActionTarget, pod: Option<&PodDetails>) -> Result<String, String> {
    let Some(pod) = pod else {
        return Ok(String::new());
    };

    let mut outputs = Vec::new();
    for container in previous_log_container_names(pod) {
        let Ok(output) = pod_container_previous_logs(target, &container).await else {
            continue;
        };

        if output.trim().is_empty() {
            continue;
        }

        outputs.push(prefix_container_log_lines(target, &container, &output));
    }

    Ok(outputs.join("\n"))
}

async fn pod_container_previous_logs(target: &ActionTarget, container: &str) -> Result<String, String> {
    kubectl(kubectl_target_args(
        target,
        vec![
            "logs".to_string(),
            target.name.clone(),
            "-n".to_string(),
            target.namespace.clone(),
            "-c".to_string(),
            container.to_string(),
            "--previous=true".to_string(),
            "--tail=240".to_string(),
            "--timestamps".to_string(),
        ],
    ))
    .await
}

fn previous_log_container_names(pod: &PodDetails) -> Vec<String> {
    let mut names = Vec::new();
    for container in &pod.containers {
        if container_has_previous_instance(container) && !names.contains(&container.name) {
            names.push(container.name.clone());
        }
    }
    names
}

fn container_has_previous_instance(container: &ContainerDetails) -> bool {
    container.restart_count > 0
        || container.last_exit_code.is_some()
        || !container.last_reason.is_empty()
        || !container.last_started_at.is_empty()
        || !container.last_finished_at.is_empty()
}

fn prefix_container_log_lines(target: &ActionTarget, container: &str, output: &str) -> String {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| format!("[{}/{}] {line}", target.name, container))
        .collect::<Vec<_>>()
        .join("\n")
}

async fn pod_details(target: &ActionTarget) -> Result<PodDetails, String> {
    let output = kubectl(kubectl_target_args(
        target,
        vec![
            "get".to_string(),
            "pod".to_string(),
            target.name.clone(),
            "-n".to_string(),
            target.namespace.clone(),
            "-o".to_string(),
            "json".to_string(),
        ],
    ))
    .await?;
    let pod = serde_json::from_str::<serde_json::Value>(&output).map_err(|error| format!("Invalid pod JSON: {error}"))?;
    let status = pod.get("status").unwrap_or(&serde_json::Value::Null);
    let spec = pod.get("spec").unwrap_or(&serde_json::Value::Null);
    let app_containers = container_status_details(status, spec, "containerStatuses", "containers", "app");
    let ready_containers = app_containers.iter().filter(|container| container.ready).count();
    let total_containers = app_containers.len();
    let mut containers = container_status_details(status, spec, "initContainerStatuses", "initContainers", "init");
    containers.extend(app_containers);
    containers.extend(container_status_details(
        status,
        spec,
        "ephemeralContainerStatuses",
        "ephemeralContainers",
        "ephemeral",
    ));
    let conditions = status
        .get("conditions")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .map(|condition| PodCondition {
                    type_: text_field(condition, "type", "Condition"),
                    status: text_field(condition, "status", "Unknown"),
                    reason: text_field(condition, "reason", ""),
                    message: text_field(condition, "message", ""),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(PodDetails {
        phase: text_field(status, "phase", "Unknown"),
        reason: text_field(status, "reason", ""),
        message: text_field(status, "message", ""),
        node_name: text_field(spec, "nodeName", ""),
        pod_ip: text_field(status, "podIP", ""),
        host_ip: text_field(status, "hostIP", ""),
        qos_class: text_field(status, "qosClass", ""),
        start_time: text_field(status, "startTime", ""),
        ready_containers,
        total_containers,
        conditions,
        containers,
        scheduling: pod_scheduling(spec),
    })
}

fn pod_scheduling(spec: &serde_json::Value) -> PodSchedulingDetails {
    PodSchedulingDetails {
        node_selector: string_map_field(spec, "nodeSelector"),
        priority_class_name: text_field(spec, "priorityClassName", ""),
        scheduler_name: text_field(spec, "schedulerName", "default-scheduler"),
        service_account_name: text_field(spec, "serviceAccountName", "default"),
        tolerations: toleration_summaries(spec.get("tolerations")),
        affinity: affinity_summaries(spec.get("affinity")),
        scheduling_gates: scheduling_gate_summaries(spec.get("schedulingGates")),
        runtime_class_name: text_field(spec, "runtimeClassName", ""),
    }
}

fn string_map_field(value: &serde_json::Value, field: &str) -> BTreeMap<String, String> {
    value
        .get(field)
        .and_then(|item| item.as_object())
        .map(|items| {
            items
                .iter()
                .filter_map(|(key, value)| json_scalar(value).map(|text| (key.clone(), text)))
                .collect()
        })
        .unwrap_or_default()
}

fn json_scalar(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_i64().map(|number| number.to_string()))
        .or_else(|| value.as_u64().map(|number| number.to_string()))
        .or_else(|| value.as_bool().map(|flag| flag.to_string()))
        .filter(|text| !text.is_empty())
}

fn toleration_summaries(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|items| items.as_array())
        .map(|items| items.iter().filter_map(toleration_summary).take(6).collect())
        .unwrap_or_default()
}

fn toleration_summary(value: &serde_json::Value) -> Option<String> {
    let key = text_field(value, "key", "");
    let operator = text_field(value, "operator", "");
    let effect = text_field(value, "effect", "");
    let comparison = match text_field(value, "value", "").as_str() {
        "" => operator,
        toleration_value => format!("={toleration_value}"),
    };
    let selector = if key.is_empty() { "all".to_string() } else { format!("{key}{comparison}") };

    Some(if effect.is_empty() { selector } else { format!("{selector}:{effect}") })
}

fn affinity_summaries(value: Option<&serde_json::Value>) -> Vec<String> {
    let Some(affinity) = value else {
        return Vec::new();
    };

    [
        ("node", "nodeAffinity"),
        ("pod", "podAffinity"),
        ("anti-pod", "podAntiAffinity"),
    ]
    .into_iter()
    .filter_map(|(label, field)| affinity.get(field).filter(|item| !item.is_null()).map(|_| label.to_string()))
    .collect()
}

fn scheduling_gate_summaries(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|items| items.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|gate| Some(text_field(gate, "name", "")).filter(|name| !name.is_empty()))
                .take(6)
                .collect()
        })
        .unwrap_or_default()
}

fn container_status_details(
    status: &serde_json::Value,
    spec: &serde_json::Value,
    status_field: &str,
    spec_field: &str,
    role: &str,
) -> Vec<ContainerDetails> {
    let spec_items = spec
        .get(spec_field)
        .and_then(|value| value.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default();
    let status_items = status
        .get(status_field)
        .and_then(|value| value.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default();
    let mut containers = spec_items
        .iter()
        .map(|spec_container| {
            let name = text_field(spec_container, "name", "container");
            let status_container = status_items
                .iter()
                .find(|container| text_field(container, "name", "") == name)
                .unwrap_or(&serde_json::Value::Null);

            container_details(status_container, spec_container, &name, role)
        })
        .collect::<Vec<_>>();

    for status_container in status_items {
        let name = text_field(status_container, "name", "container");
        let has_spec = spec_items
            .iter()
            .any(|spec_container| text_field(spec_container, "name", "") == name);

        if !has_spec {
            containers.push(container_details(status_container, &serde_json::Value::Null, &name, role));
        }
    }

    containers
}

fn container_details(container: &serde_json::Value, spec: &serde_json::Value, name: &str, role: &str) -> ContainerDetails {
    let state = container.get("state").unwrap_or(&serde_json::Value::Null);
    let state_name = state
        .as_object()
        .and_then(|states| states.keys().next())
        .cloned()
        .unwrap_or_else(|| {
            if container.is_null() {
                "pending"
            } else {
                "unknown"
            }
            .to_string()
        });
    let state_body = state.get(&state_name).unwrap_or(&serde_json::Value::Null);
    let reason_fallback = if state_name == "pending" {
        "status pending"
    } else {
        ""
    };
    let last_terminated = container
        .get("lastState")
        .and_then(|last_state| last_state.get("terminated"))
        .unwrap_or(&serde_json::Value::Null);

    ContainerDetails {
        name: name.to_string(),
        role: role.to_string(),
        image: first_text_field(&[container, spec], "image"),
        ports: container_ports(spec),
        probes: container_probes(spec),
        requests: container_resource_quantities(spec, "requests"),
        limits: container_resource_quantities(spec, "limits"),
        ready: container
            .get("ready")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        restart_count: container
            .get("restartCount")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32,
        state: state_name,
        reason: text_field(state_body, "reason", reason_fallback),
        message: text_field(state_body, "message", ""),
        exit_code: numeric_field(state_body, "exitCode"),
        started_at: text_field(state_body, "startedAt", ""),
        finished_at: text_field(state_body, "finishedAt", ""),
        last_reason: text_field(last_terminated, "reason", ""),
        last_exit_code: numeric_field(last_terminated, "exitCode"),
        last_started_at: text_field(last_terminated, "startedAt", ""),
        last_finished_at: text_field(last_terminated, "finishedAt", ""),
    }
}

fn container_probes(container: &serde_json::Value) -> Vec<ContainerProbe> {
    [
        ("readiness", "readinessProbe"),
        ("liveness", "livenessProbe"),
        ("startup", "startupProbe"),
    ]
    .into_iter()
    .filter_map(|(kind, field)| probe_check(container.get(field)).map(|check| ContainerProbe {
        kind: kind.to_string(),
        check,
    }))
    .collect()
}

fn probe_check(probe: Option<&serde_json::Value>) -> Option<String> {
    let probe = probe?;
    let check = if let Some(http_get) = probe.get("httpGet") {
        format!("http {}:{}", text_field(http_get, "path", "/"), probe_port(http_get.get("port")))
    } else if let Some(tcp_socket) = probe.get("tcpSocket") {
        format!("tcp {}", probe_port(tcp_socket.get("port")))
    } else if let Some(grpc) = probe.get("grpc") {
        format!("grpc {}", probe_port(grpc.get("port")))
    } else if let Some(exec) = probe.get("exec") {
        let command = exec
            .get("command")
            .and_then(|value| value.as_array())
            .map(|parts| parts.iter().filter_map(|part| part.as_str()).take(3).collect::<Vec<_>>().join(" "))
            .filter(|command| !command.is_empty())
            .unwrap_or_else(|| "command".to_string());
        format!("exec {command}")
    } else {
        return None;
    };

    Some(check)
}

fn probe_port(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|port| port.as_str().map(str::to_string).or_else(|| port.as_u64().map(|number| number.to_string())))
        .filter(|port| !port.is_empty())
        .unwrap_or_else(|| "?".to_string())
}

fn container_ports(container: &serde_json::Value) -> Vec<u16> {
    container
        .get("ports")
        .and_then(|value| value.as_array())
        .map(|ports| {
            ports
                .iter()
                .filter_map(|port| port.get("containerPort").and_then(|value| value.as_u64()))
                .filter(|port| (1..=u16::MAX as u64).contains(port))
                .map(|port| port as u16)
                .collect()
        })
        .unwrap_or_default()
}

fn container_resource_quantities(container: &serde_json::Value, field: &str) -> BTreeMap<String, String> {
    container
        .pointer(&format!("/resources/{field}"))
        .and_then(|resources| resources.as_object())
        .map(|resources| {
            resources
                .iter()
                .filter_map(|(name, quantity)| resource_quantity(quantity).map(|value| (name.clone(), value)))
                .collect()
        })
        .unwrap_or_default()
}

fn resource_quantity(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_string)
        .or_else(|| value.as_u64().map(|number| number.to_string()))
        .filter(|value| !value.is_empty())
}

fn classify_action(action: &str) -> ActionRisk {
    match action {
        "delete" | "apply" | "edit" | "scale" | "set-image" | "rollback" => ActionRisk::High,
        "restart" | "debug" | "exec" | "node-shell" | "port-forward" | "trigger-cronjob" => ActionRisk::Medium,
        _ => ActionRisk::Low,
    }
}

async fn guarded_pod_write(action: String, target: ActionTarget, confirmed: bool, is_local: bool) -> PodActionResult {
    if !is_local {
        return pod_action_result(
            action,
            PodActionStatus::Blocked,
            format!("{} is blocked because {} is not recognized as a local context.", target.name, target.cluster),
            String::new(),
            String::new(),
            false,
        );
    }

    let command = if action == "restart" {
        match restart_command(&target).await {
            Ok(command) => command,
            Err(message) => {
                return pod_action_result(action, PodActionStatus::Blocked, message, String::new(), String::new(), false);
            }
        }
    } else {
        vec![
            "delete".to_string(),
            "pod".to_string(),
            target.name.clone(),
            "-n".to_string(),
            target.namespace.clone(),
        ]
    };
    let display_command = display_kubectl_command(&target, &command);

    if !confirmed {
        return pod_action_result(
            action,
            PodActionStatus::Blocked,
            format!("Confirm to run against {}/{} on {}.", target.namespace, target.name, target.cluster),
            String::new(),
            display_command,
            true,
        );
    }

    match kubectl(kubectl_target_args(&target, command)).await {
        Ok(output) => pod_action_result(action, PodActionStatus::Executed, "Action completed.".to_string(), output, display_command, false),
        Err(error) => pod_action_result(action, PodActionStatus::Failed, error, String::new(), display_command, false),
    }
}

async fn guarded_workload_restart(action: String, target: ActionTarget, confirmed: bool, is_local: bool) -> PodActionResult {
    if !is_local {
        return pod_action_result(
            action,
            PodActionStatus::Blocked,
            format!("{} is blocked because {} is not recognized as a local context.", target.name, target.cluster),
            String::new(),
            String::new(),
            false,
        );
    }

    let command = rollout_restart_args(&target.kind, &target.name, &target.namespace);
    let display_command = display_kubectl_command(&target, &command);

    if !confirmed {
        return pod_action_result(
            action,
            PodActionStatus::Blocked,
            format!("Confirm to restart {}/{} on {}.", target.namespace, target.name, target.cluster),
            String::new(),
            display_command,
            true,
        );
    }

    match kubectl(kubectl_target_args(&target, command)).await {
        Ok(output) => pod_action_result(action, PodActionStatus::Executed, "Action completed.".to_string(), output, display_command, false),
        Err(error) => pod_action_result(action, PodActionStatus::Failed, error, String::new(), display_command, false),
    }
}

async fn restart_command(target: &ActionTarget) -> Result<Vec<String>, String> {
    let owner = kubectl(kubectl_target_args(target, vec![
        "get".to_string(),
        "pod".to_string(),
        target.name.clone(),
        "-n".to_string(),
        target.namespace.clone(),
        "-o".to_string(),
        "jsonpath={.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}".to_string(),
    ]))
    .await?;

    let Some(owner) = owner_ref(&owner) else {
        return Err("Pod has no owning workload to restart.".to_string());
    };

    if owner.kind == "ReplicaSet" {
        let deployment = replica_set_deployment_owner(target, &owner.name).await?;
        return Ok(rollout_restart_args("Deployment", &deployment, &target.namespace));
    }

    rollout_restart_args_for_owner(&owner, &target.namespace)
}

async fn replica_set_deployment_owner(target: &ActionTarget, replica_set: &str) -> Result<String, String> {
    let owner = kubectl(kubectl_target_args(target, vec![
        "get".to_string(),
        "replicaset.apps".to_string(),
        replica_set.to_string(),
        "-n".to_string(),
        target.namespace.clone(),
        "-o".to_string(),
        "jsonpath={.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}".to_string(),
    ]))
    .await?;
    let Some(owner) = owner_ref(&owner) else {
        return Err(format!("ReplicaSet/{replica_set} has no owning Deployment to restart."));
    };

    if owner.kind != "Deployment" {
        return Err(format!(
            "Restart is not available for pods owned by ReplicaSet/{replica_set} via {}/{}.",
            owner.kind, owner.name
        ));
    }

    Ok(owner.name)
}

#[derive(Debug, PartialEq, Eq)]
struct OwnerRef {
    kind: String,
    name: String,
}

fn owner_ref(value: &str) -> Option<OwnerRef> {
    let (kind, name) = value.trim().split_once('/')?;
    if kind.is_empty() || name.is_empty() {
        return None;
    }

    Some(OwnerRef {
        kind: kind.to_string(),
        name: name.to_string(),
    })
}

fn is_restartable_workload_kind(kind: &str) -> bool {
    matches!(kind, "Deployment" | "StatefulSet" | "DaemonSet")
}

fn rollout_restart_args_for_owner(owner: &OwnerRef, namespace: &str) -> Result<Vec<String>, String> {
    if matches!(owner.kind.as_str(), "Deployment" | "StatefulSet" | "DaemonSet") {
        return Ok(rollout_restart_args(&owner.kind, &owner.name, namespace));
    }

    Err(format!("Restart is not available for pods owned by {}.", owner.kind))
}

fn rollout_restart_args(kind: &str, name: &str, namespace: &str) -> Vec<String> {
    vec![
        "rollout".to_string(),
        "restart".to_string(),
        format!("{}/{}", kind.to_lowercase(), name),
        "-n".to_string(),
        namespace.to_string(),
    ]
}

fn annotate_service_backends(resources: &mut [ResourceSummary]) {
    let pods = resources
        .iter()
        .filter(|resource| resource.kind == "Pod")
        .map(|pod| (pod.namespace.clone(), pod.labels.clone(), pod.backend_ready))
        .collect::<Vec<_>>();
    let endpoint_slices = endpoint_slice_signals(resources);

    for service in resources.iter_mut().filter(|resource| resource.kind == "Service") {
        if let Some((status, diagnostic)) = strongest_service_annotation(
            selected_pod_service_annotation(service, &pods),
            endpoint_slice_service_annotation(service, &endpoint_slices),
        ) {
            mark_service_backend_status(service, status, diagnostic);
        }
    }
}

type ServiceAnnotation = (HealthState, String);

struct EndpointSliceSignal {
    namespace: String,
    service_name: String,
    status: HealthState,
    diagnostic: String,
}

fn selected_pod_service_annotation(
    service: &ResourceSummary,
    pods: &[(String, BTreeMap<String, String>, bool)],
) -> Option<ServiceAnnotation> {
    if service.selector.is_empty() {
        return None;
    }

    let selected_pods = pods
        .iter()
        .filter(|(namespace, labels, _)| namespace == &service.namespace && selector_matches(labels, &service.selector))
        .collect::<Vec<_>>();

    if selected_pods.is_empty() {
        return Some((HealthState::Critical, "no selected pods".to_string()));
    }

    let ready = selected_pods.iter().filter(|(_, _, ready)| *ready).count();
    if ready == selected_pods.len() {
        return None;
    }

    let diagnostic = format!("{ready}/{} backend pods ready", selected_pods.len());
    let status = if ready == 0 {
        HealthState::Critical
    } else {
        HealthState::Warning
    };
    Some((status, diagnostic))
}

fn endpoint_slice_service_annotation(
    service: &ResourceSummary,
    endpoint_slices: &[EndpointSliceSignal],
) -> Option<ServiceAnnotation> {
    let slices = endpoint_slices
        .iter()
        .filter(|slice| slice.namespace == service.namespace && slice.service_name == service.name)
        .collect::<Vec<_>>();

    if slices.is_empty() {
        return if service.selector.is_empty() && service.image != "ExternalName" {
            Some((HealthState::Critical, "no endpoint slices".to_string()))
        } else {
            None
        };
    }

    let healthy = slices.iter().filter(|slice| slice.status == HealthState::Healthy).count();
    if healthy == slices.len() {
        return None;
    }

    let status = if healthy == 0 && slices.iter().all(|slice| slice.status == HealthState::Critical) {
        HealthState::Critical
    } else {
        HealthState::Warning
    };

    Some((status, service_endpoint_slice_diagnostic(&slices)))
}

fn service_endpoint_slice_diagnostic(slices: &[&EndpointSliceSignal]) -> String {
    let degraded = slices
        .iter()
        .filter(|slice| slice.status != HealthState::Healthy)
        .collect::<Vec<_>>();

    if degraded.len() == 1 && !degraded[0].diagnostic.is_empty() {
        return degraded[0].diagnostic.clone();
    }

    let ready = slices.iter().filter(|slice| slice.status == HealthState::Healthy).count();
    format!("{ready}/{} endpoint slices ready", slices.len())
}

fn endpoint_slice_signals(resources: &[ResourceSummary]) -> Vec<EndpointSliceSignal> {
    resources
        .iter()
        .filter(|resource| resource.kind == "EndpointSlice")
        .flat_map(|slice| {
            slice
                .references
                .iter()
                .filter(|reference| reference.kind == "Service")
                .map(|reference| EndpointSliceSignal {
                    namespace: reference.namespace.clone(),
                    service_name: reference.name.clone(),
                    status: slice.status.clone(),
                    diagnostic: slice.diagnostic.clone(),
                })
        })
        .collect()
}

fn strongest_service_annotation(
    left: Option<ServiceAnnotation>,
    right: Option<ServiceAnnotation>,
) -> Option<ServiceAnnotation> {
    match (left, right) {
        (Some(left), Some(right)) => {
            if service_annotation_rank(&right.0) < service_annotation_rank(&left.0) {
                Some(right)
            } else {
                Some(left)
            }
        }
        (Some(annotation), None) | (None, Some(annotation)) => Some(annotation),
        (None, None) => None,
    }
}

fn service_annotation_rank(status: &HealthState) -> u8 {
    match status {
        HealthState::Critical => 0,
        HealthState::Warning => 1,
        HealthState::Syncing => 2,
        HealthState::Healthy => 3,
    }
}

fn selector_matches(labels: &BTreeMap<String, String>, selector: &BTreeMap<String, String>) -> bool {
    selector.iter().all(|(key, value)| labels.get(key) == Some(value))
}

fn mark_service_backend_status(service: &mut ResourceSummary, status: HealthState, diagnostic: String) {
    let pressure = match status {
        HealthState::Critical => 70,
        HealthState::Warning => 44,
        HealthState::Syncing => 28,
        HealthState::Healthy => 12,
    };

    service.status = status;
    service.diagnostic = diagnostic;
    service.cpu = service.cpu.max(pressure);
    service.memory = service.cpu.saturating_add(8).min(100);
}

fn annotate_warning_events(resources: &mut [ResourceSummary]) {
    let event_signals = resources
        .iter()
        .filter(|resource| resource.kind == "Event" && resource.status == HealthState::Warning)
        .flat_map(|event| {
            let diagnostic = event_warning_diagnostic(event);
            event
                .references
                .iter()
                .cloned()
                .map(move |reference| (reference, diagnostic.clone()))
        })
        .collect::<Vec<_>>();

    for (reference, diagnostic) in event_signals {
        if let Some(resource) = resources
            .iter_mut()
            .find(|resource| resource.kind != "Event" && resource_matches_reference(resource, &reference))
        {
            mark_warning_event_status(resource, diagnostic);
        }
    }
}

fn event_warning_diagnostic(event: &ResourceSummary) -> String {
    if event.diagnostic.is_empty() {
        "warning event".to_string()
    } else {
        format!("event {}", event.diagnostic)
    }
}

fn resource_matches_reference(resource: &ResourceSummary, reference: &ResourceReference) -> bool {
    resource.kind == reference.kind &&
        resource.name == reference.name &&
        (reference.namespace == "cluster" || resource.namespace == reference.namespace)
}

fn mark_warning_event_status(resource: &mut ResourceSummary, diagnostic: String) {
    if resource.status == HealthState::Healthy {
        resource.status = HealthState::Warning;
    }
    if resource.diagnostic.is_empty() {
        resource.diagnostic = diagnostic;
    }
    resource.cpu = resource.cpu.max(44);
    resource.memory = resource.memory.max(52);
}

async fn first_pod_port(target: &ActionTarget) -> Result<u16, String> {
    let output = kubectl(kubectl_target_args(
        target,
        vec![
            "get".to_string(),
            "pod".to_string(),
            target.name.clone(),
            "-n".to_string(),
            target.namespace.clone(),
            "-o".to_string(),
            "json".to_string(),
        ],
    ))
    .await?;
    let pod = serde_json::from_str::<serde_json::Value>(&output).map_err(|error| format!("Invalid pod JSON: {error}"))?;
    ["containers", "initContainers", "ephemeralContainers"]
        .into_iter()
        .filter_map(|field| pod.pointer(&format!("/spec/{field}")).and_then(|value| value.as_array()))
        .flat_map(|containers| containers.iter().flat_map(container_ports))
        .next()
        .ok_or_else(|| "Pod has no declared container ports.".to_string())
}

fn is_local_context(context: &str) -> bool {
    let normalized = context.to_lowercase();
    normalized.starts_with("k3d-")
        || normalized.starts_with("kind-")
        || normalized == "minikube"
        || normalized == "docker-desktop"
        || normalized.contains("localhost")
}

fn pod_action_result(
    action: String,
    status: PodActionStatus,
    message: String,
    output: String,
    command: String,
    requires_confirmation: bool,
) -> PodActionResult {
    PodActionResult {
        action,
        status,
        message,
        output,
        command,
        requires_confirmation,
    }
}

async fn resource_events(target: &ActionTarget) -> Result<Vec<ResourceEvent>, String> {
    let mut args = vec![
        "get".to_string(),
        "events".to_string(),
        "--field-selector".to_string(),
        event_field_selector(target),
        "-o".to_string(),
        "json".to_string(),
    ];

    if target.namespace == "cluster" {
        args.insert(2, "-A".to_string());
    } else {
        args.insert(2, target.namespace.clone());
        args.insert(2, "-n".to_string());
    }

    let output = kubectl(kubectl_target_args(target, args)).await?;
    let parsed = serde_json::from_str::<serde_json::Value>(&output).map_err(|error| format!("Invalid events JSON: {error}"))?;
    let events = parsed
        .get("items")
        .and_then(|items| items.as_array())
        .map(|items| resource_events_from_items(items))
        .unwrap_or_default();

    Ok(events)
}

fn event_field_selector(target: &ActionTarget) -> String {
    format!("involvedObject.name={},involvedObject.kind={}", target.name, target.kind)
}

fn resource_events_from_items(items: &[serde_json::Value]) -> Vec<ResourceEvent> {
    let mut events = items
        .iter()
        .map(|event| (event_timestamp(event), resource_event(event)))
        .collect::<Vec<_>>();
    events.sort_by(|left, right| right.0.cmp(&left.0));
    events.into_iter().map(|(_, event)| event).collect()
}

fn resource_event(event: &serde_json::Value) -> ResourceEvent {
    ResourceEvent {
        type_: text_field(event, "type", "Normal"),
        reason: text_field(event, "reason", "Event"),
        message: text_field(event, "message", ""),
        age: event_age(event),
        count: numeric_field(event, "count").unwrap_or(1).max(1),
    }
}

fn event_age(event: &serde_json::Value) -> String {
    let timestamp = event_timestamp(event);
    if timestamp.is_empty() {
        "live".to_string()
    } else {
        short_age(&timestamp)
    }
}

fn event_timestamp(event: &serde_json::Value) -> String {
    event
        .get("lastTimestamp")
        .or_else(|| event.get("eventTime"))
        .or_else(|| event.pointer("/metadata/creationTimestamp"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string()
}

fn resource_yaml_args(target: &ActionTarget) -> Vec<String> {
    resource_output_args(target, "yaml")
}

fn resource_describe_args(target: &ActionTarget) -> Vec<String> {
    let mut args = vec!["describe".to_string(), target.kind.clone(), target.name.clone()];

    if target.namespace != "cluster" {
        args.insert(3, target.namespace.clone());
        args.insert(3, "-n".to_string());
    }

    add_context_args(&mut args, &target.cluster);
    args
}

fn resource_json_args(target: &ActionTarget) -> Vec<String> {
    resource_output_args(target, "json")
}

fn resource_output_args(target: &ActionTarget, output: &str) -> Vec<String> {
    let mut args = vec![
        "get".to_string(),
        target.kind.clone(),
        target.name.clone(),
        "-o".to_string(),
        output.to_string(),
    ];

    if target.namespace != "cluster" {
        args.insert(3, target.namespace.clone());
        args.insert(3, "-n".to_string());
    }

    add_context_args(&mut args, &target.cluster);
    args
}

async fn kubectl(args: Vec<String>) -> Result<String, String> {
    command_output("kubectl", args).await
}

fn kubectl_target_args(target: &ActionTarget, args: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut args = args.into_iter().collect::<Vec<_>>();
    add_context_args(&mut args, &target.cluster);
    args
}

fn display_kubectl_command(target: &ActionTarget, args: &[String]) -> String {
    let args = kubectl_target_args(target, args.iter().cloned());
    format!("kubectl {}", args.join(" "))
}

fn add_context_args(args: &mut Vec<String>, context: &str) {
    if context.is_empty() {
        return;
    }

    args.insert(0, context.to_string());
    args.insert(0, "--context".to_string());
}

async fn client_for_context(context: &str) -> Result<Client, String> {
    let options = KubeConfigOptions {
        context: if context.is_empty() { None } else { Some(context.to_string()) },
        ..KubeConfigOptions::default()
    };
    let config = Config::from_kubeconfig(&options)
        .await
        .map_err(|error| format!("Unable to load kube context {context}: {error}"))?;

    Client::try_from(config).map_err(|error| format!("Unable to create Kubernetes client for {context}: {error}"))
}

fn selected_context_name(context: Option<String>, contexts: &[KubeContextSummary]) -> Result<String, String> {
    if let Some(context) = context.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()) {
        if contexts.is_empty() || contexts.iter().any(|entry| entry.name == context) {
            return Ok(context);
        }
        return Err(format!("Kubernetes context {context} was not found in kubeconfig."));
    }

    contexts
        .iter()
        .find(|context| context.current)
        .or_else(|| contexts.first())
        .map(|context| context.name.clone())
        .ok_or_else(|| "No Kubernetes contexts found in kubeconfig.".to_string())
}

async fn command_output(command: &str, args: Vec<String>) -> Result<String, String> {
    let output = tokio::process::Command::new(command_path(command))
        .args(args)
        .output()
        .await
        .map_err(|error| format!("Unable to run {command}: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn command_path(command: &str) -> PathBuf {
    candidate_command_paths(command)
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(command))
}

fn candidate_command_paths(command: &str) -> Vec<PathBuf> {
    let mut candidates = env::var_os("PATH")
        .map(|path| env::split_paths(&path).map(|dir| dir.join(command)).collect::<Vec<_>>())
        .unwrap_or_default();

    candidates.extend([
        PathBuf::from("/opt/homebrew/bin").join(command),
        PathBuf::from("/usr/local/bin").join(command),
        PathBuf::from("/opt/local/bin").join(command),
        PathBuf::from("/usr/bin").join(command),
        PathBuf::from("/bin").join(command),
    ]);
    candidates
}

fn helm_target_args(target: &ActionTarget, args: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut args = args.into_iter().collect::<Vec<_>>();
    if !target.cluster.is_empty() {
        args.push("--kube-context".to_string());
        args.push(target.cluster.clone());
    }
    args
}

fn pod_exec_command(target: &ActionTarget, container: Option<&str>) -> String {
    let mut args = Vec::new();
    if !target.cluster.is_empty() {
        args.push("--context".to_string());
        args.push(target.cluster.clone());
    }
    args.extend([
        "exec".to_string(),
        "-n".to_string(),
        target.namespace.clone(),
        "-it".to_string(),
        target.name.clone(),
    ]);
    if let Some(container) = container {
        args.push("-c".to_string());
        args.push(container.to_string());
    }
    args.extend(["--".to_string(), "/bin/sh".to_string()]);

    terminal_kubectl_command(args)
}

fn pod_port_forward_command(target: &ActionTarget, port: u16) -> String {
    let mut args = Vec::new();
    if !target.cluster.is_empty() {
        args.push("--context".to_string());
        args.push(target.cluster.clone());
    }
    args.extend([
        "port-forward".to_string(),
        "-n".to_string(),
        target.namespace.clone(),
        format!("pod/{}", target.name),
        format!(":{port}"),
    ]);

    terminal_kubectl_command(args)
}

fn terminal_kubectl_command(args: Vec<String>) -> String {
    format!(
        "{} {}",
        shell_quote(&command_path("kubectl").to_string_lossy()),
        args.iter()
            .map(|arg| shell_quote(arg))
            .collect::<Vec<_>>()
            .join(" ")
    )
}

async fn open_terminal(command: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Terminal handoff is only wired to open Terminal on macOS for now. Run this command manually.".to_string());
    }

    let script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        applescript_string(command)
    );
    let output = tokio::process::Command::new(command_path("osascript"))
        .args([
            "-e",
            "tell application \"Terminal\" to activate",
            "-e",
            &script,
        ])
        .output()
        .await
        .map_err(|error| format!("Unable to open Terminal: {error}. Run this command manually."))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Unable to open Terminal: {}. Run this command manually.",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|char| char.is_ascii_alphanumeric() || matches!(char, '-' | '_' | '.' | '/' | ':' | '=' | '@'))
    {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', "'\\''"))
}

fn applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn text_field(value: &serde_json::Value, field: &str, fallback: &str) -> String {
    value
        .get(field)
        .and_then(|field| field.as_str())
        .unwrap_or(fallback)
        .to_string()
}

fn first_text_field(values: &[&serde_json::Value], field: &str) -> String {
    values
        .iter()
        .find_map(|value| {
            value
                .get(field)
                .and_then(|field| field.as_str())
                .filter(|field| !field.is_empty())
        })
        .unwrap_or_default()
        .to_string()
}

fn numeric_field(value: &serde_json::Value, field: &str) -> Option<u32> {
    value
        .get(field)
        .and_then(|field| field.as_u64())
        .map(|value| value.min(u32::MAX as u64) as u32)
}

fn short_age(timestamp: &str) -> String {
    timestamp.split('T').next().unwrap_or(timestamp).to_string()
}

fn resource_age(metadata: &ObjectMeta) -> String {
    metadata
        .creation_timestamp
        .as_ref()
        .map(|timestamp| timestamp.0.to_string())
        .unwrap_or_else(|| "live".to_string())
}

fn owner_label(metadata: &ObjectMeta) -> String {
    metadata
        .owner_references
        .as_ref()
        .and_then(|owners| owners.first())
        .map(|owner| format!("{}/{}", owner.kind, owner.name))
        .unwrap_or_default()
}

async fn list_pods(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let pods = Api::<Pod>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list pods: {error}"))?;

    Ok(pods
        .items
        .into_iter()
        .map(|pod| {
            let namespace = pod.namespace().unwrap_or_else(|| "default".to_string());
            let age = resource_age(&pod.metadata);
            let restarts = pod.status.as_ref().map(pod_restart_count).unwrap_or(0);
            let last_restart_at = pod
                .status
                .as_ref()
                .map(pod_last_restart_at)
                .unwrap_or_default();
            let image = pod
                .status
                .as_ref()
                .and_then(|status| status.container_statuses.as_ref())
                .and_then(|statuses| statuses.first())
                .map(|status| status.image.clone())
                .unwrap_or_default();
            let status = pod_status(&pod, restarts);
            let owner = owner_label(&pod.metadata);
            let labels = pod.metadata.labels.clone().unwrap_or_default();
            let references = pod_dependency_references(&pod, &namespace);
            let node_name = pod
                .spec
                .as_ref()
                .and_then(|spec| spec.node_name.clone())
                .unwrap_or_default();

            resource_summary("Pod", pod.name_any(), namespace, cluster, status, restarts, image)
                .with_age(age)
                .with_labels(labels)
                .with_owner(owner)
                .with_node_name(node_name)
                .with_diagnostic(pod_diagnostic(&pod))
                .with_backend_ready(pod_backend_ready(&pod))
                .with_last_restart_at(last_restart_at)
                .with_references(references)
        })
        .collect())
}

async fn list_deployments(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let deployments = Api::<Deployment>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list deployments: {error}"))?;

    Ok(deployments
        .items
        .into_iter()
        .map(|deployment| {
            let age = resource_age(&deployment.metadata);
            let desired = deployment.spec.as_ref().and_then(|spec| spec.replicas).unwrap_or(1);
            let ready = deployment.status.as_ref().and_then(|status| status.ready_replicas).unwrap_or(0);
            let image = deployment
                .spec
                .as_ref()
                .and_then(|spec| spec.template.spec.as_ref())
                .and_then(|spec| spec.containers.first())
                .map(|container| container.image.clone().unwrap_or_default())
                .unwrap_or_default();
            let labels = deployment.metadata.labels.clone().unwrap_or_default();
            let selector = deployment.spec.as_ref().and_then(|spec| spec.selector.match_labels.clone()).unwrap_or_default();

            resource_summary(
                "Deployment",
                deployment.name_any(),
                deployment.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                workload_status(ready, desired),
                0,
                image,
            )
            .with_age(age)
            .with_diagnostic(workload_diagnostic(ready, desired))
            .with_labels(labels)
            .with_selector(selector)
        })
        .collect())
}

async fn list_replicasets(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let replicasets = Api::<ReplicaSet>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list ReplicaSets: {error}"))?;

    Ok(replicasets
        .items
        .into_iter()
        .map(|replicaset| {
            let age = resource_age(&replicaset.metadata);
            let desired = replicaset.spec.as_ref().and_then(|spec| spec.replicas).unwrap_or(1);
            let ready = replicaset.status.as_ref().and_then(|status| status.ready_replicas).unwrap_or(0);
            let image = replicaset
                .spec
                .as_ref()
                .and_then(|spec| spec.template.as_ref())
                .and_then(|template| template.spec.as_ref())
                .and_then(|spec| spec.containers.first())
                .map(|container| container.image.clone().unwrap_or_default())
                .unwrap_or_default();
            let labels = replicaset.metadata.labels.clone().unwrap_or_default();
            let selector = replicaset.spec.as_ref().and_then(|spec| spec.selector.match_labels.clone()).unwrap_or_default();
            let owner = owner_label(&replicaset.metadata);

            resource_summary(
                "ReplicaSet",
                replicaset.name_any(),
                replicaset.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                workload_status(ready, desired),
                0,
                image,
            )
            .with_age(age)
            .with_diagnostic(workload_diagnostic(ready, desired))
            .with_labels(labels)
            .with_owner(owner)
            .with_selector(selector)
        })
        .collect())
}

async fn list_statefulsets(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let statefulsets = Api::<StatefulSet>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list StatefulSets: {error}"))?;

    Ok(statefulsets
        .items
        .into_iter()
        .map(|statefulset| {
            let age = resource_age(&statefulset.metadata);
            let desired = statefulset.spec.as_ref().and_then(|spec| spec.replicas).unwrap_or(1);
            let ready = statefulset.status.as_ref().and_then(|status| status.ready_replicas).unwrap_or(0);
            let image = statefulset
                .spec
                .as_ref()
                .and_then(|spec| spec.template.spec.as_ref())
                .and_then(|spec| spec.containers.first())
                .map(|container| container.image.clone().unwrap_or_default())
                .unwrap_or_default();
            let labels = statefulset.metadata.labels.clone().unwrap_or_default();
            let selector = statefulset.spec.as_ref().and_then(|spec| spec.selector.match_labels.clone()).unwrap_or_default();

            resource_summary(
                "StatefulSet",
                statefulset.name_any(),
                statefulset.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                workload_status(ready, desired),
                0,
                image,
            )
            .with_age(age)
            .with_diagnostic(workload_diagnostic(ready, desired))
            .with_labels(labels)
            .with_selector(selector)
        })
        .collect())
}

async fn list_daemonsets(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let daemonsets = Api::<DaemonSet>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list DaemonSets: {error}"))?;

    Ok(daemonsets
        .items
        .into_iter()
        .map(|daemonset| {
            let age = resource_age(&daemonset.metadata);
            let desired = daemonset
                .status
                .as_ref()
                .map(|status| status.desired_number_scheduled)
                .unwrap_or(0);
            let ready = daemonset.status.as_ref().map(|status| status.number_ready).unwrap_or(0);
            let image = daemonset
                .spec
                .as_ref()
                .and_then(|spec| spec.template.spec.as_ref())
                .and_then(|spec| spec.containers.first())
                .map(|container| container.image.clone().unwrap_or_default())
                .unwrap_or_default();
            let labels = daemonset.metadata.labels.clone().unwrap_or_default();
            let selector = daemonset.spec.as_ref().and_then(|spec| spec.selector.match_labels.clone()).unwrap_or_default();

            resource_summary(
                "DaemonSet",
                daemonset.name_any(),
                daemonset.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                workload_status(ready, desired),
                0,
                image,
            )
            .with_age(age)
            .with_diagnostic(workload_diagnostic(ready, desired))
            .with_labels(labels)
            .with_selector(selector)
        })
        .collect())
}

async fn list_jobs(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let jobs = Api::<Job>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list Jobs: {error}"))?;

    Ok(jobs
        .items
        .into_iter()
        .map(|job| {
            let age = resource_age(&job.metadata);
            let status = job_status(&job);
            let image = job
                .spec
                .as_ref()
                .and_then(|spec| spec.template.spec.as_ref())
                .and_then(|spec| spec.containers.first())
                .map(|container| container.image.clone().unwrap_or_default())
                .unwrap_or_default();
            let labels = job.metadata.labels.clone().unwrap_or_default();
            let selector = job
                .spec
                .as_ref()
                .and_then(|spec| spec.selector.as_ref())
                .and_then(|selector| selector.match_labels.clone())
                .unwrap_or_default();
            let owner = owner_label(&job.metadata);

            resource_summary(
                "Job",
                job.name_any(),
                job.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                status,
                0,
                image,
            )
            .with_age(age)
            .with_labels(labels)
            .with_owner(owner)
            .with_selector(selector)
        })
        .collect())
}

async fn list_cronjobs(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let cronjobs = Api::<CronJob>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list CronJobs: {error}"))?;

    Ok(cronjobs
        .items
        .into_iter()
        .map(|cronjob| {
            let age = resource_age(&cronjob.metadata);
            let suspended = cronjob.spec.as_ref().and_then(|spec| spec.suspend).unwrap_or(false);
            let labels = cronjob.metadata.labels.clone().unwrap_or_default();

            resource_summary(
                "CronJob",
                cronjob.name_any(),
                cronjob.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                if suspended { HealthState::Warning } else { HealthState::Healthy },
                0,
                cronjob.spec.as_ref().map(|spec| spec.schedule.clone()).unwrap_or_default(),
            )
            .with_age(age)
            .with_labels(labels)
        })
        .collect())
}

async fn list_horizontal_pod_autoscalers(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let hpas = Api::<HorizontalPodAutoscaler>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list HorizontalPodAutoscalers: {error}"))?;

    Ok(hpas
        .items
        .into_iter()
        .map(|hpa| {
            let age = resource_age(&hpa.metadata);
            let namespace = hpa.namespace().unwrap_or_else(|| "default".to_string());
            let labels = hpa.metadata.labels.clone().unwrap_or_default();
            let (current, desired) = hpa_replica_counts(&hpa);
            let target = hpa.spec.as_ref().map(|spec| &spec.scale_target_ref);
            let owner = target.map(|target| format!("{}/{}", target.kind, target.name)).unwrap_or_else(|| namespace.clone());
            let references = target
                .map(|target| vec![resource_reference(&target.kind, &namespace, &target.name)])
                .unwrap_or_default();

            resource_summary(
                "HorizontalPodAutoscaler",
                hpa.name_any(),
                namespace,
                cluster,
                hpa_status(&hpa),
                0,
                hpa_scale_range(&hpa),
            )
            .with_age(age)
            .with_diagnostic(hpa_diagnostic(&hpa, current, desired))
            .with_labels(labels)
            .with_owner(owner)
            .with_references(references)
        })
        .collect())
}

async fn list_services(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let services = Api::<Service>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list services: {error}"))?;

    Ok(services
        .items
        .into_iter()
        .map(|service| {
            let age = resource_age(&service.metadata);
            let selector = service.spec.as_ref().and_then(|spec| spec.selector.clone()).unwrap_or_default();
            let type_ = service.spec.as_ref().and_then(|spec| spec.type_.clone()).unwrap_or_default();
            resource_summary(
                "Service",
                service.name_any(),
                service.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                HealthState::Healthy,
                0,
                type_,
            )
            .with_age(age)
            .with_selector(selector)
        })
        .collect())
}

async fn list_endpoint_slices(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let endpoint_slices = Api::<EndpointSlice>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list endpoint slices: {error}"))?;

    Ok(endpoint_slices
        .items
        .into_iter()
        .map(|slice| endpoint_slice_summary(slice, cluster))
        .collect())
}

fn endpoint_slice_summary(slice: EndpointSlice, cluster: &str) -> ResourceSummary {
    let age = resource_age(&slice.metadata);
    let labels = slice.metadata.labels.clone().unwrap_or_default();
    let namespace = slice.namespace().unwrap_or_else(|| "default".to_string());
    let service_name = labels.get("kubernetes.io/service-name").cloned().unwrap_or_default();
    let ready_count = slice.endpoints.iter().filter(|endpoint| endpoint_ready(endpoint)).count();
    let endpoint_count = slice.endpoints.len();
    let port_count = slice.ports.as_deref().unwrap_or_default().len();

    resource_summary(
        "EndpointSlice",
        slice.name_any(),
        namespace.clone(),
        cluster,
        endpoint_slice_status(endpoint_count, ready_count),
        0,
        endpoint_slice_kind_summary(&slice.address_type, port_count),
    )
    .with_age(age)
    .with_owner(if service_name.is_empty() { namespace.clone() } else { format!("Service/{service_name}") })
    .with_diagnostic(endpoint_slice_diagnostic(endpoint_count, ready_count))
    .with_labels(labels)
    .with_references(endpoint_slice_references(&slice, &namespace, &service_name))
}

fn endpoint_slice_status(endpoint_count: usize, ready_count: usize) -> HealthState {
    if endpoint_count == 0 || ready_count == 0 {
        HealthState::Critical
    } else if ready_count == endpoint_count {
        HealthState::Healthy
    } else {
        HealthState::Warning
    }
}

fn endpoint_slice_diagnostic(endpoint_count: usize, ready_count: usize) -> String {
    if endpoint_count == 0 {
        return "no endpoints".to_string();
    }
    if ready_count == endpoint_count {
        return String::new();
    }
    format!("{ready_count}/{endpoint_count} endpoints ready")
}

fn endpoint_slice_kind_summary(address_type: &str, port_count: usize) -> String {
    let ports = if port_count == 1 { "1 port".to_string() } else { format!("{port_count} ports") };
    if address_type.is_empty() {
        ports
    } else {
        format!("{address_type} · {ports}")
    }
}

fn endpoint_slice_references(slice: &EndpointSlice, namespace: &str, service_name: &str) -> Vec<ResourceReference> {
    let mut references = Vec::new();
    if !service_name.is_empty() {
        references.push(resource_reference("Service", namespace, service_name));
    }

    for endpoint in &slice.endpoints {
        if let Some(target) = endpoint.target_ref.as_ref() {
            if let (Some(kind), Some(name)) = (target.kind.as_deref(), target.name.as_deref()) {
                push_unique_reference(
                    &mut references,
                    resource_reference(
                        kind,
                        target
                            .namespace
                            .as_deref()
                            .filter(|value| !value.is_empty())
                            .unwrap_or(namespace),
                        name,
                    ),
                );
            }
        }
    }
    references
}

fn endpoint_ready(endpoint: &Endpoint) -> bool {
    let Some(conditions) = endpoint.conditions.as_ref() else {
        return true;
    };

    conditions.ready.unwrap_or(true)
        && conditions.serving.unwrap_or(true)
        && !conditions.terminating.unwrap_or(false)
}

async fn list_ingresses(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let ingresses = Api::<Ingress>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list ingresses: {error}"))?;

    Ok(ingresses
        .items
        .into_iter()
        .map(|ingress| {
            let age = resource_age(&ingress.metadata);
            let labels = ingress.metadata.labels.clone().unwrap_or_default();
            let namespace = ingress.namespace().unwrap_or_else(|| "default".to_string());
            let spec = ingress.spec.as_ref();
            let class = spec
                .and_then(|spec| spec.ingress_class_name.clone())
                .unwrap_or_default();
            let hosts = spec
                .and_then(|spec| spec.rules.as_ref())
                .map(|rules| {
                    rules
                        .iter()
                        .filter_map(|rule| rule.host.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let has_default_backend = spec.and_then(|spec| spec.default_backend.as_ref()).is_some();
            let host_summary = if hosts.is_empty() {
                class
            } else {
                hosts.join(", ")
            };

            resource_summary(
                "Ingress",
                ingress.name_any(),
                namespace.clone(),
                cluster,
                ingress_status(hosts.len(), has_default_backend),
                0,
                host_summary,
            )
            .with_age(age)
            .with_labels(labels)
            .with_references(ingress_backend_references(&ingress, &namespace))
        })
        .collect())
}

async fn list_network_policies(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let policies = Api::<NetworkPolicy>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list NetworkPolicies: {error}"))?;

    Ok(policies
        .items
        .into_iter()
        .map(|policy| {
            let age = resource_age(&policy.metadata);
            let labels = policy.metadata.labels.clone().unwrap_or_default();
            let namespace = policy.namespace().unwrap_or_else(|| "default".to_string());
            let selector = network_policy_selector(&policy);
            let ingress_rules = network_policy_ingress_rule_count(&policy);
            let egress_rules = network_policy_egress_rule_count(&policy);

            resource_summary(
                "NetworkPolicy",
                policy.name_any(),
                namespace,
                cluster,
                HealthState::Healthy,
                0,
                format!("{ingress_rules} ingress / {egress_rules} egress"),
            )
            .with_age(age)
            .with_owner(network_policy_types(&policy).join("/"))
            .with_diagnostic(network_policy_selector_summary(&policy, &selector))
            .with_labels(labels)
            .with_selector(selector)
        })
        .collect())
}

fn network_policy_selector(policy: &NetworkPolicy) -> BTreeMap<String, String> {
    policy
        .spec
        .as_ref()
        .and_then(|spec| spec.pod_selector.as_ref())
        .and_then(|selector| selector.match_labels.clone())
        .unwrap_or_default()
}

fn network_policy_ingress_rule_count(policy: &NetworkPolicy) -> usize {
    policy
        .spec
        .as_ref()
        .and_then(|spec| spec.ingress.as_ref())
        .map(Vec::len)
        .unwrap_or(0)
}

fn network_policy_egress_rule_count(policy: &NetworkPolicy) -> usize {
    policy
        .spec
        .as_ref()
        .and_then(|spec| spec.egress.as_ref())
        .map(Vec::len)
        .unwrap_or(0)
}

fn network_policy_types(policy: &NetworkPolicy) -> Vec<String> {
    if let Some(types) = policy
        .spec
        .as_ref()
        .and_then(|spec| spec.policy_types.as_ref())
        .filter(|types| !types.is_empty())
    {
        return types.clone();
    }

    if policy.spec.as_ref().and_then(|spec| spec.egress.as_ref()).is_some() {
        vec!["Ingress".to_string(), "Egress".to_string()]
    } else {
        vec!["Ingress".to_string()]
    }
}

fn network_policy_selector_summary(policy: &NetworkPolicy, selector: &BTreeMap<String, String>) -> String {
    if network_policy_has_selector_expressions(policy) {
        return "selector expression".to_string();
    }
    if selector.is_empty() {
        return "all pods".to_string();
    }

    let visible = selector
        .iter()
        .take(2)
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(", ");
    if selector.len() > 2 {
        format!("{visible} +{}", selector.len() - 2)
    } else {
        visible
    }
}

fn network_policy_has_selector_expressions(policy: &NetworkPolicy) -> bool {
    policy
        .spec
        .as_ref()
        .and_then(|spec| spec.pod_selector.as_ref())
        .and_then(|selector| selector.match_expressions.as_ref())
        .map(|expressions| !expressions.is_empty())
        .unwrap_or(false)
}

async fn list_gateway_api_resources(client: Client, cluster: &str) -> Vec<ResourceSummary> {
    let mut resources = Vec::new();
    resources.extend(
        list_gateway_api_kind(client.clone(), cluster, "Gateway", "gateways")
            .await
            .unwrap_or_default(),
    );
    resources.extend(
        list_gateway_api_kind(client, cluster, "HTTPRoute", "httproutes")
            .await
            .unwrap_or_default(),
    );
    resources
}

async fn list_gateway_api_kind(
    client: Client,
    cluster: &str,
    kind: &str,
    plural: &str,
) -> Result<Vec<ResourceSummary>, String> {
    let gvk = GroupVersionKind::gvk("gateway.networking.k8s.io", "v1", kind);
    let api_resource = ApiResource::from_gvk_with_plural(&gvk, plural);
    let api = Api::<DynamicObject>::all_with(client, &api_resource);
    let objects = api
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list {plural}: {error}"))?;

    Ok(objects
        .items
        .into_iter()
        .map(|object| gateway_api_resource_summary(kind, object, cluster))
        .collect())
}

fn gateway_api_resource_summary(
    kind: &str,
    object: DynamicObject,
    cluster: &str,
) -> ResourceSummary {
    let labels = object.metadata.labels.clone().unwrap_or_default();
    let namespace = object.namespace().unwrap_or_else(|| "default".to_string());
    let age = resource_age(&object.metadata);
    let status = gateway_api_status(&object.data);
    let owner = gateway_api_owner(kind, &object.data);
    let summary = gateway_api_summary(kind, &object.data);
    let references = gateway_api_backend_references(kind, &object.data, &namespace);

    resource_summary(kind, object.name_any(), namespace, cluster, status, 0, summary)
        .with_age(age)
        .with_labels(labels)
        .with_owner(owner)
        .with_references(references)
}

fn gateway_api_backend_references(kind: &str, data: &serde_json::Value, namespace: &str) -> Vec<ResourceReference> {
    if kind != "HTTPRoute" {
        return Vec::new();
    }

    let mut references = Vec::new();
    let rules = data
        .pointer("/spec/rules")
        .and_then(|value| value.as_array())
        .map(Vec::as_slice)
        .unwrap_or_default();

    for backend in rules
        .iter()
        .flat_map(|rule| rule.get("backendRefs").and_then(|value| value.as_array()).map(Vec::as_slice).unwrap_or_default())
    {
        let group = text_field(backend, "group", "");
        let backend_kind = text_field(backend, "kind", "Service");
        if !group.is_empty() || backend_kind != "Service" {
            continue;
        }

        let reference_namespace = backend
            .get("namespace")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(namespace);
        push_unique_reference(
            &mut references,
            resource_reference("Service", reference_namespace, &text_field(backend, "name", "")),
        );
    }

    references
}

fn ingress_backend_references(ingress: &Ingress, namespace: &str) -> Vec<ResourceReference> {
    let mut references = Vec::new();
    let Some(spec) = ingress.spec.as_ref() else {
        return references;
    };

    if let Some(backend) = spec.default_backend.as_ref() {
        push_ingress_backend_reference(&mut references, namespace, backend);
    }

    for path in spec
        .rules
        .as_deref()
        .unwrap_or_default()
        .iter()
        .filter_map(|rule| rule.http.as_ref())
        .flat_map(|http| http.paths.iter())
    {
        push_ingress_backend_reference(&mut references, namespace, &path.backend);
    }

    references
}

fn push_ingress_backend_reference(
    references: &mut Vec<ResourceReference>,
    namespace: &str,
    backend: &k8s_openapi::api::networking::v1::IngressBackend,
) {
    if let Some(service) = backend.service.as_ref() {
        push_unique_reference(references, resource_reference("Service", namespace, &service.name));
    }
}

fn gateway_api_owner(kind: &str, data: &serde_json::Value) -> String {
    if kind == "Gateway" {
        return data
            .pointer("/spec/gatewayClassName")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
    }

    data.pointer("/spec/parentRefs")
        .and_then(|value| value.as_array())
        .map(|parents| {
            parents
                .iter()
                .filter_map(|parent| parent.get("name").and_then(|value| value.as_str()))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default()
}

fn gateway_api_summary(kind: &str, data: &serde_json::Value) -> String {
    if kind == "Gateway" {
        let hostnames = data
            .pointer("/spec/listeners")
            .and_then(|value| value.as_array())
            .map(|listeners| {
                listeners
                    .iter()
                    .filter_map(|listener| listener.get("hostname").and_then(|value| value.as_str()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if hostnames.is_empty() {
            return gateway_api_owner(kind, data);
        }
        return hostnames.join(", ");
    }

    data.pointer("/spec/hostnames")
        .and_then(|value| value.as_array())
        .map(|hostnames| {
            hostnames
                .iter()
                .filter_map(|hostname| hostname.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|hostnames| !hostnames.is_empty())
        .unwrap_or_else(|| gateway_api_owner(kind, data))
}

fn gateway_api_status(data: &serde_json::Value) -> HealthState {
    let conditions = gateway_api_conditions(data);
    if conditions.is_empty() {
        return HealthState::Syncing;
    }

    if conditions.iter().any(|condition| gateway_api_condition_is_unhealthy(condition)) {
        return HealthState::Warning;
    }

    if conditions.iter().any(|condition| gateway_api_condition_is_syncing(condition)) {
        return HealthState::Syncing;
    }

    HealthState::Healthy
}

fn gateway_api_condition_is_unhealthy(condition: &serde_json::Value) -> bool {
    let type_ = condition_type(condition);
    let status = condition_status(condition);

    match type_ {
        "Accepted" | "Programmed" | "Ready" | "ResolvedRefs" => status == "False",
        "Conflicted" | "Detached" | "PartiallyInvalid" => status == "True",
        _ => false,
    }
}

fn gateway_api_condition_is_syncing(condition: &serde_json::Value) -> bool {
    let type_ = condition_type(condition);
    let status = condition_status(condition);

    matches!(type_, "Accepted" | "Programmed" | "Ready" | "ResolvedRefs") && status == "Unknown"
}

fn gateway_api_conditions(data: &serde_json::Value) -> Vec<&serde_json::Value> {
    let mut conditions = data
        .pointer("/status/conditions")
        .and_then(|value| value.as_array())
        .map(|conditions| conditions.iter().collect::<Vec<_>>())
        .unwrap_or_default();

    if let Some(parents) = data.pointer("/status/parents").and_then(|value| value.as_array()) {
        for parent in parents {
            conditions.extend(
                parent
                    .get("conditions")
                    .and_then(|value| value.as_array())
                    .map(|conditions| conditions.iter().collect::<Vec<_>>())
                    .unwrap_or_default(),
            );
        }
    }

    conditions
}

fn condition_status(condition: &serde_json::Value) -> &str {
    condition
        .get("status")
        .and_then(|value| value.as_str())
        .unwrap_or("Unknown")
}

fn condition_type(condition: &serde_json::Value) -> &str {
    condition
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("")
}

async fn list_configmaps(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let configmaps = Api::<ConfigMap>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list ConfigMaps: {error}"))?;

    Ok(configmaps
        .items
        .into_iter()
        .map(|configmap| {
            let age = resource_age(&configmap.metadata);
            let key_count = configmap.data.as_ref().map(|data| data.len()).unwrap_or(0);
            let labels = configmap.metadata.labels.clone().unwrap_or_default();

            resource_summary(
                "ConfigMap",
                configmap.name_any(),
                configmap.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                HealthState::Healthy,
                0,
                format!("{key_count} keys"),
            )
            .with_age(age)
            .with_labels(labels)
        })
        .collect())
}

async fn list_secrets(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let secrets = Api::<Secret>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list Secrets: {error}"))?;

    Ok(secrets
        .items
        .into_iter()
        .map(|secret| {
            let age = resource_age(&secret.metadata);
            let labels = secret.metadata.labels.clone().unwrap_or_default();

            resource_summary(
                "Secret",
                secret.name_any(),
                secret.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                HealthState::Healthy,
                0,
                secret.type_.unwrap_or_default(),
            )
            .with_age(age)
            .with_labels(labels)
        })
        .collect())
}

async fn list_service_accounts(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let accounts = Api::<ServiceAccount>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list ServiceAccounts: {error}"))?;

    Ok(accounts
        .items
        .into_iter()
        .map(|account| {
            let age = resource_age(&account.metadata);
            let labels = account.metadata.labels.clone().unwrap_or_default();
            let secret_count = account.secrets.as_ref().map(|secrets| secrets.len()).unwrap_or(0);
            let pull_secret_count = account
                .image_pull_secrets
                .as_ref()
                .map(|secrets| secrets.len())
                .unwrap_or(0);
            let token_policy = match account.automount_service_account_token {
                Some(false) => "manual token",
                _ => "automount token",
            };

            resource_summary(
                "ServiceAccount",
                account.name_any(),
                account.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                HealthState::Healthy,
                0,
                token_policy.to_string(),
            )
            .with_age(age)
            .with_labels(labels)
            .with_owner(format!("{secret_count} secrets / {pull_secret_count} pulls"))
        })
        .collect())
}

async fn list_persistent_volume_claims(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let claims = Api::<PersistentVolumeClaim>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list PersistentVolumeClaims: {error}"))?;

    Ok(claims
        .items
        .into_iter()
        .map(|claim| {
            let age = resource_age(&claim.metadata);
            let phase = claim
                .status
                .as_ref()
                .and_then(|status| status.phase.as_deref())
                .unwrap_or("Pending");
            let labels = claim.metadata.labels.clone().unwrap_or_default();
            let spec = claim.spec.as_ref();
            let storage_class = spec
                .and_then(|spec| spec.storage_class_name.clone())
                .unwrap_or_default();
            let volume_name = spec.and_then(|spec| spec.volume_name.clone()).unwrap_or_default();

            resource_summary(
                "PersistentVolumeClaim",
                claim.name_any(),
                claim.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                volume_phase_status(phase),
                0,
                storage_class,
            )
            .with_age(age)
            .with_labels(labels)
            .with_owner(volume_name)
        })
        .collect())
}

async fn list_persistent_volumes(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let volumes = Api::<PersistentVolume>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list PersistentVolumes: {error}"))?;

    Ok(volumes
        .items
        .into_iter()
        .map(|volume| {
            let age = resource_age(&volume.metadata);
            let phase = volume
                .status
                .as_ref()
                .and_then(|status| status.phase.as_deref())
                .unwrap_or("Pending");
            let labels = volume.metadata.labels.clone().unwrap_or_default();
            let spec = volume.spec.as_ref();
            let storage_class = spec
                .and_then(|spec| spec.storage_class_name.clone())
                .unwrap_or_default();
            let claim_ref = spec
                .and_then(|spec| spec.claim_ref.as_ref())
                .map(|claim| {
                    let namespace = claim.namespace.clone().unwrap_or_else(|| "default".to_string());
                    let name = claim.name.clone().unwrap_or_default();
                    format!("{namespace}/{name}")
                })
                .unwrap_or_default();

            resource_summary(
                "PersistentVolume",
                volume.name_any(),
                "cluster".to_string(),
                cluster,
                volume_phase_status(phase),
                0,
                storage_class,
            )
            .with_age(age)
            .with_labels(labels)
            .with_owner(claim_ref)
        })
        .collect())
}

async fn list_storage_classes(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let classes = Api::<StorageClass>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list StorageClasses: {error}"))?;

    Ok(classes
        .items
        .into_iter()
        .map(|class| {
            let age = resource_age(&class.metadata);
            let labels = class.metadata.labels.clone().unwrap_or_default();
            let reclaim_policy = class.reclaim_policy.clone().unwrap_or_default();

            resource_summary(
                "StorageClass",
                class.name_any(),
                "cluster".to_string(),
                cluster,
                HealthState::Healthy,
                0,
                class.provisioner,
            )
            .with_age(age)
            .with_labels(labels)
            .with_owner(reclaim_policy)
        })
        .collect())
}

async fn list_roles(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let roles = Api::<Role>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list Roles: {error}"))?;

    Ok(roles
        .items
        .into_iter()
        .map(|role| {
            let age = resource_age(&role.metadata);
            let rule_count = role.rules.as_ref().map(|rules| rules.len()).unwrap_or(0);
            let labels = role.metadata.labels.clone().unwrap_or_default();

            resource_summary(
                "Role",
                role.name_any(),
                role.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                HealthState::Healthy,
                0,
                format!("{rule_count} rules"),
            )
            .with_age(age)
            .with_labels(labels)
        })
        .collect())
}

async fn list_role_bindings(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let bindings = Api::<RoleBinding>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list RoleBindings: {error}"))?;

    Ok(bindings
        .items
        .into_iter()
        .map(|binding| {
            let age = resource_age(&binding.metadata);
            let namespace = binding.namespace().unwrap_or_else(|| "default".to_string());
            let role_ref = format!("{}/{}", binding.role_ref.kind, binding.role_ref.name);
            let labels = binding.metadata.labels.clone().unwrap_or_default();
            let references = binding_subject_references(binding.subjects.as_ref(), &namespace);

            resource_summary(
                "RoleBinding",
                binding.name_any(),
                namespace,
                cluster,
                HealthState::Healthy,
                0,
                role_ref.clone(),
            )
            .with_age(age)
            .with_labels(labels)
            .with_owner(role_ref)
            .with_references(references)
        })
        .collect())
}

async fn list_cluster_roles(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let roles = Api::<ClusterRole>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list ClusterRoles: {error}"))?;

    Ok(roles
        .items
        .into_iter()
        .map(|role| {
            let age = resource_age(&role.metadata);
            let rule_count = role.rules.as_ref().map(|rules| rules.len()).unwrap_or(0);
            let labels = role.metadata.labels.clone().unwrap_or_default();

            resource_summary(
                "ClusterRole",
                role.name_any(),
                "cluster".to_string(),
                cluster,
                HealthState::Healthy,
                0,
                format!("{rule_count} rules"),
            )
            .with_age(age)
            .with_labels(labels)
        })
        .collect())
}

async fn list_cluster_role_bindings(
    client: Client,
    cluster: &str,
) -> Result<Vec<ResourceSummary>, String> {
    let bindings = Api::<ClusterRoleBinding>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list ClusterRoleBindings: {error}"))?;

    Ok(bindings
        .items
        .into_iter()
        .map(|binding| {
            let age = resource_age(&binding.metadata);
            let role_ref = format!("{}/{}", binding.role_ref.kind, binding.role_ref.name);
            let labels = binding.metadata.labels.clone().unwrap_or_default();
            let references = binding_subject_references(binding.subjects.as_ref(), "cluster");

            resource_summary(
                "ClusterRoleBinding",
                binding.name_any(),
                "cluster".to_string(),
                cluster,
                HealthState::Healthy,
                0,
                role_ref.clone(),
            )
            .with_age(age)
            .with_labels(labels)
            .with_owner(role_ref)
            .with_references(references)
        })
        .collect())
}

async fn list_events(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let events = Api::<Event>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list events: {error}"))?;

    Ok(events
        .items
        .into_iter()
        .map(|event| {
            let age = resource_age(&event.metadata);
            let namespace = event.namespace().unwrap_or_else(|| "default".to_string());
            let event_type = event.type_.clone().unwrap_or_else(|| "Normal".to_string());
            let reason = event.reason.clone().unwrap_or_default();
            let references = event_involved_references(&event, &namespace);
            let owner = references
                .first()
                .map(|reference| format!("{}/{}", reference.kind, reference.name))
                .unwrap_or_else(|| reason.clone());
            resource_summary(
                "Event",
                event.name_any(),
                namespace,
                cluster,
                if event_type == "Warning" { HealthState::Warning } else { HealthState::Healthy },
                0,
                event_type,
            )
            .with_age(age)
            .with_owner(owner)
            .with_diagnostic(reason)
            .with_references(references)
        })
        .collect())
}

async fn list_nodes(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let nodes = Api::<Node>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list nodes: {error}"))?;

    Ok(nodes
        .items
        .into_iter()
        .map(|node| {
            let age = resource_age(&node.metadata);
            let ready = node
                .status
                .as_ref()
                .and_then(|status| status.conditions.as_ref())
                .and_then(|conditions| conditions.iter().find(|condition| condition.type_ == "Ready"))
                .map(|condition| condition.status == "True")
                .unwrap_or(false);
            resource_summary(
                "Node",
                node.name_any(),
                "cluster".to_string(),
                cluster,
                if ready { HealthState::Healthy } else { HealthState::Critical },
                0,
                String::new(),
            )
            .with_age(age)
        })
        .collect())
}

async fn list_namespaces(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let namespaces = Api::<Namespace>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list namespaces: {error}"))?;

    Ok(namespaces
        .items
        .into_iter()
        .map(|namespace| {
            let age = resource_age(&namespace.metadata);
            resource_summary(
                "Namespace",
                namespace.name_any(),
                "cluster".to_string(),
                cluster,
                HealthState::Healthy,
                0,
                String::new(),
            )
            .with_age(age)
        })
        .collect())
}

async fn list_helm_releases(cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let mut args = vec!["list".to_string(), "-A".to_string(), "-o".to_string(), "json".to_string()];
    if !cluster.is_empty() {
        args.push("--kube-context".to_string());
        args.push(cluster.to_string());
    }
    let output = command_output("helm", args).await?;
    let releases = serde_json::from_str::<Vec<HelmRelease>>(&output).map_err(|error| format!("Invalid Helm JSON: {error}"))?;

    Ok(releases
        .into_iter()
        .map(|release| {
            resource_summary(
                "HelmRelease",
                release.name,
                if release.namespace.is_empty() { "default".to_string() } else { release.namespace },
                cluster,
                if release.status == "deployed" { HealthState::Healthy } else { HealthState::Warning },
                0,
                if release.app_version.is_empty() { release.revision } else { release.app_version },
            )
            .with_owner(release.chart)
            .with_age(short_age(&release.updated))
        })
        .collect())
}

async fn list_crds(client: Client, cluster: &str) -> Result<Vec<ResourceSummary>, String> {
    let crds = Api::<CustomResourceDefinition>::all(client)
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list CRDs: {error}"))?;

    Ok(crds
        .items
        .into_iter()
        .map(|crd| {
            let age = resource_age(&crd.metadata);
            let group = crd.spec.group.clone();
            resource_summary(
                "CustomResourceDefinition",
                crd.name_any(),
                "cluster".to_string(),
                cluster,
                HealthState::Healthy,
                0,
                group.clone(),
            )
            .with_age(age)
            .with_owner(group)
        })
        .collect())
}

fn resource_summary(
    kind: &str,
    name: String,
    namespace: String,
    cluster: &str,
    status: HealthState,
    restarts: u32,
    image: String,
) -> ResourceSummary {
    let pressure = (restarts * 9
        + match status {
            HealthState::Critical => 70,
            HealthState::Warning => 44,
            HealthState::Syncing => 28,
            HealthState::Healthy => 12,
        })
    .min(100) as u8;

    ResourceSummary {
        id: format!("{kind}:{namespace}:{name}"),
        kind: kind.to_string(),
        name,
        namespace: namespace.clone(),
        cluster: cluster.to_string(),
        status,
        age: "live".to_string(),
        cpu: pressure,
        memory: pressure.saturating_add(8).min(100),
        restarts,
        last_restart_at: String::new(),
        owner: namespace,
        image,
        node_name: String::new(),
        diagnostic: String::new(),
        backend_ready: false,
        labels: BTreeMap::new(),
        references: Vec::new(),
        selector: BTreeMap::new(),
    }
}

fn pod_dependency_references(pod: &Pod, namespace: &str) -> Vec<ResourceReference> {
    let mut references = pod_volume_references(pod, namespace);
    if let Some(reference) = pod_service_account_reference(pod, namespace) {
        push_unique_reference(&mut references, reference);
    }
    for reference in pod_image_pull_secret_references(pod, namespace) {
        push_unique_reference(&mut references, reference);
    }
    for reference in pod_env_references(pod, namespace) {
        push_unique_reference(&mut references, reference);
    }
    references
}

fn pod_service_account_reference(pod: &Pod, namespace: &str) -> Option<ResourceReference> {
    pod.spec
        .as_ref()
        .and_then(|spec| spec.service_account_name.as_deref())
        .filter(|name| !name.is_empty())
        .map(|name| resource_reference("ServiceAccount", namespace, name))
}

fn pod_image_pull_secret_references(pod: &Pod, namespace: &str) -> Vec<ResourceReference> {
    pod.spec
        .as_ref()
        .and_then(|spec| spec.image_pull_secrets.as_deref())
        .unwrap_or_default()
        .iter()
        .map(|secret| resource_reference("Secret", namespace, &secret.name))
        .collect()
}

fn pod_volume_references(pod: &Pod, namespace: &str) -> Vec<ResourceReference> {
    pod.spec
        .as_ref()
        .and_then(|spec| spec.volumes.as_deref())
        .unwrap_or_default()
        .iter()
        .flat_map(|volume| {
            let mut references = Vec::new();
            if let Some(config_map) = volume.config_map.as_ref() {
                if !config_map.name.is_empty() {
                    references.push(resource_reference("ConfigMap", namespace, &config_map.name));
                }
            }
            if let Some(secret) = volume.secret.as_ref().and_then(|source| source.secret_name.as_ref()) {
                references.push(resource_reference("Secret", namespace, secret));
            }
            if let Some(claim) = volume.persistent_volume_claim.as_ref() {
                if !claim.claim_name.is_empty() {
                    references.push(resource_reference("PersistentVolumeClaim", namespace, &claim.claim_name));
                }
            }
            references
        })
        .collect()
}

fn pod_env_references(pod: &Pod, namespace: &str) -> Vec<ResourceReference> {
    let Some(spec) = pod.spec.as_ref() else {
        return Vec::new();
    };

    let mut references = Vec::new();
    for container in &spec.containers {
        collect_env_references(container.env.as_ref(), container.env_from.as_ref(), namespace, &mut references);
    }
    for container in spec.init_containers.as_deref().unwrap_or_default() {
        collect_env_references(container.env.as_ref(), container.env_from.as_ref(), namespace, &mut references);
    }
    for container in spec.ephemeral_containers.as_deref().unwrap_or_default() {
        collect_env_references(container.env.as_ref(), container.env_from.as_ref(), namespace, &mut references);
    }
    references
}

fn collect_env_references(
    env: Option<&Vec<EnvVar>>,
    env_from: Option<&Vec<EnvFromSource>>,
    namespace: &str,
    references: &mut Vec<ResourceReference>,
) {
    for source in env_from.map(Vec::as_slice).unwrap_or_default() {
        if let Some(config_map) = source.config_map_ref.as_ref() {
            push_unique_reference(references, resource_reference("ConfigMap", namespace, &config_map.name));
        }
        if let Some(secret) = source.secret_ref.as_ref() {
            push_unique_reference(references, resource_reference("Secret", namespace, &secret.name));
        }
    }

    for variable in env.map(Vec::as_slice).unwrap_or_default() {
        let Some(value_from) = variable.value_from.as_ref() else {
            continue;
        };
        if let Some(config_map) = value_from.config_map_key_ref.as_ref() {
            push_unique_reference(references, resource_reference("ConfigMap", namespace, &config_map.name));
        }
        if let Some(secret) = value_from.secret_key_ref.as_ref() {
            push_unique_reference(references, resource_reference("Secret", namespace, &secret.name));
        }
    }
}

fn push_unique_reference(references: &mut Vec<ResourceReference>, reference: ResourceReference) {
    if reference.name.is_empty() || references.iter().any(|item| {
        item.kind == reference.kind && item.namespace == reference.namespace && item.name == reference.name
    }) {
        return;
    }
    references.push(reference);
}

fn resource_reference(kind: &str, namespace: &str, name: &str) -> ResourceReference {
    ResourceReference {
        kind: kind.to_string(),
        namespace: namespace.to_string(),
        name: name.to_string(),
    }
}

fn binding_subject_references(subjects: Option<&Vec<Subject>>, fallback_namespace: &str) -> Vec<ResourceReference> {
    let mut references = Vec::new();

    for subject in subjects.map(Vec::as_slice).unwrap_or_default() {
        if subject.kind != "ServiceAccount" || subject.name.is_empty() {
            continue;
        }

        let namespace = subject
            .namespace
            .as_deref()
            .filter(|namespace| !namespace.is_empty())
            .or_else(|| (fallback_namespace != "cluster").then_some(fallback_namespace));
        let Some(namespace) = namespace else {
            continue;
        };

        push_unique_reference(&mut references, resource_reference("ServiceAccount", namespace, &subject.name));
    }

    references
}

fn event_involved_references(event: &Event, fallback_namespace: &str) -> Vec<ResourceReference> {
    let involved = &event.involved_object;
    match (involved.kind.as_deref(), involved.name.as_deref()) {
        (Some(kind), Some(name)) if !kind.is_empty() && !name.is_empty() => {
            vec![resource_reference(
                kind,
                involved
                    .namespace
                    .as_deref()
                    .filter(|namespace| !namespace.is_empty())
                    .unwrap_or(fallback_namespace),
                name,
            )]
        }
        _ => Vec::new(),
    }
}

fn workload_status(ready: i32, desired: i32) -> HealthState {
    if desired == 0 || ready >= desired {
        HealthState::Healthy
    } else if ready == 0 {
        HealthState::Critical
    } else {
        HealthState::Warning
    }
}

fn workload_diagnostic(ready: i32, desired: i32) -> String {
    if desired == 0 || ready >= desired {
        return String::new();
    }
    format!("{}/{} ready", ready.max(0), desired.max(0))
}

fn hpa_status(hpa: &HorizontalPodAutoscaler) -> HealthState {
    let conditions = hpa.status.as_ref().and_then(|status| status.conditions.as_deref()).unwrap_or_default();
    if conditions.iter().any(|condition| matches!(condition.type_.as_str(), "AbleToScale" | "ScalingActive") && condition.status == "False") {
        return HealthState::Critical;
    }
    if conditions.iter().any(|condition| condition.type_ == "ScalingLimited" && condition.status == "True") {
        return HealthState::Warning;
    }

    let (current, desired) = hpa_replica_counts(hpa);
    if current != desired {
        HealthState::Warning
    } else {
        HealthState::Healthy
    }
}

fn hpa_diagnostic(hpa: &HorizontalPodAutoscaler, current: i32, desired: i32) -> String {
    let conditions = hpa.status.as_ref().and_then(|status| status.conditions.as_deref()).unwrap_or_default();

    if let Some(condition) = conditions.iter().find(|condition| matches!(condition.type_.as_str(), "AbleToScale" | "ScalingActive") && condition.status == "False") {
        return condition
            .message
            .clone()
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| condition.reason.clone().unwrap_or_else(|| format!("{} false", condition.type_)));
    }

    if let Some(condition) = conditions.iter().find(|condition| condition.type_ == "ScalingLimited" && condition.status == "True") {
        return condition
            .message
            .clone()
            .filter(|message| !message.is_empty())
            .unwrap_or_else(|| condition.reason.clone().unwrap_or_else(|| "Scaling limited".to_string()));
    }

    if current != desired {
        return format!("{current}/{desired} replicas");
    }

    String::new()
}

fn hpa_replica_counts(hpa: &HorizontalPodAutoscaler) -> (i32, i32) {
    hpa.status
        .as_ref()
        .map(|status| (status.current_replicas.unwrap_or(0), status.desired_replicas))
        .unwrap_or((0, 0))
}

fn hpa_scale_range(hpa: &HorizontalPodAutoscaler) -> String {
    hpa.spec
        .as_ref()
        .map(|spec| {
            let min = spec.min_replicas.unwrap_or(1);
            format!("{min}-{} replicas", spec.max_replicas)
        })
        .unwrap_or_default()
}

fn volume_phase_status(phase: &str) -> HealthState {
    match phase {
        "Available" | "Bound" => HealthState::Healthy,
        "Failed" | "Lost" => HealthState::Critical,
        _ => HealthState::Warning,
    }
}

fn ingress_status(host_count: usize, has_default_backend: bool) -> HealthState {
    if host_count > 0 || has_default_backend {
        HealthState::Healthy
    } else {
        HealthState::Warning
    }
}

fn job_status(job: &Job) -> HealthState {
    let status = job.status.as_ref();
    let failed = status.and_then(|status| status.failed).unwrap_or(0);
    if failed > 0
        || status
            .and_then(|status| status.conditions.as_ref())
            .is_some_and(|conditions| {
                conditions
                    .iter()
                    .any(|condition| condition.type_ == "Failed" && condition.status == "True")
            })
    {
        return HealthState::Critical;
    }

    let succeeded = status.and_then(|status| status.succeeded).unwrap_or(0);
    let completions = job.spec.as_ref().and_then(|spec| spec.completions).unwrap_or(1);
    if succeeded >= completions {
        HealthState::Healthy
    } else {
        HealthState::Warning
    }
}

fn pod_status(pod: &Pod, restarts: u32) -> HealthState {
    let Some(status) = pod.status.as_ref() else {
        return HealthState::Syncing;
    };

    let phase = status.phase.as_deref().unwrap_or("");
    if phase == "Failed" {
        return HealthState::Critical;
    }

    if phase != "Succeeded"
        && (pod_has_critical_container_state(status.init_container_statuses.as_deref())
            || pod_has_critical_container_state(status.container_statuses.as_deref())
            || pod_has_critical_container_state(status.ephemeral_container_statuses.as_deref()))
    {
        return HealthState::Critical;
    }

    if phase == "Running" || phase == "Succeeded" {
        let containers = status.container_statuses.as_deref().unwrap_or_default();
        let all_ready = !containers.is_empty() && containers.iter().all(|container| container.ready);
        if phase == "Succeeded" || (all_ready && restarts == 0) {
            return HealthState::Healthy;
        }
    }

    HealthState::Warning
}

fn pod_backend_ready(pod: &Pod) -> bool {
    let Some(status) = pod.status.as_ref() else {
        return false;
    };
    if status.phase.as_deref() != Some("Running") {
        return false;
    }

    let containers = status.container_statuses.as_deref().unwrap_or_default();
    !containers.is_empty() && containers.iter().all(|container| container.ready)
}

fn pod_diagnostic(pod: &Pod) -> String {
    let Some(status) = pod.status.as_ref() else {
        return "status syncing".to_string();
    };

    let phase = status.phase.as_deref().unwrap_or("");
    if let Some(diagnostic) = container_status_diagnostic(status.init_container_statuses.as_deref()) {
        return diagnostic;
    }
    if let Some(diagnostic) = container_status_diagnostic(status.container_statuses.as_deref()) {
        return diagnostic;
    }
    if let Some(diagnostic) = container_status_diagnostic(status.ephemeral_container_statuses.as_deref()) {
        return diagnostic;
    }

    if let Some(reason) = status
        .reason
        .as_deref()
        .filter(|reason| !reason.is_empty() && *reason != phase)
    {
        return reason.to_string();
    }
    if let Some(message) = status.message.as_deref().filter(|message| !message.is_empty()) {
        return message.to_string();
    }
    if phase != "Running" && phase != "Succeeded" {
        return phase.to_string();
    }

    let restarts = pod_restart_count(status);
    if restarts > 0 {
        return format!("{restarts} restarts");
    }
    if status
        .container_statuses
        .as_deref()
        .unwrap_or_default()
        .iter()
        .any(|container| !container.ready)
    {
        return "containers not ready".to_string();
    }

    String::new()
}

fn pod_restart_count(status: &k8s_openapi::api::core::v1::PodStatus) -> u32 {
    status
        .init_container_statuses
        .as_deref()
        .unwrap_or_default()
        .iter()
        .chain(status.container_statuses.as_deref().unwrap_or_default())
        .chain(status.ephemeral_container_statuses.as_deref().unwrap_or_default())
        .map(|status| status.restart_count as u32)
        .sum()
}

fn pod_last_restart_at(status: &k8s_openapi::api::core::v1::PodStatus) -> String {
    [
        status.init_container_statuses.as_deref().unwrap_or_default(),
        status.container_statuses.as_deref().unwrap_or_default(),
        status.ephemeral_container_statuses.as_deref().unwrap_or_default(),
    ]
    .into_iter()
    .flat_map(|statuses| statuses.iter())
    .filter_map(|container| {
        let terminated = container.last_state.as_ref()?.terminated.as_ref()?;
        terminated.finished_at.as_ref().or(terminated.started_at.as_ref())
    })
    .max_by(|left, right| left.0.cmp(&right.0))
    .map(|timestamp| timestamp.0.to_string())
    .unwrap_or_default()
}

fn container_status_diagnostic(statuses: Option<&[ContainerStatus]>) -> Option<String> {
    statuses.unwrap_or_default().iter().find_map(|container| {
        let name = if container.name.is_empty() {
            "container"
        } else {
            container.name.as_str()
        };
        let state = container.state.as_ref()?;

        if let Some(waiting) = state.waiting.as_ref() {
            return state_diagnostic(name, waiting.reason.as_deref(), waiting.message.as_deref());
        }
        if let Some(terminated) = state.terminated.as_ref() {
            return state_diagnostic(name, terminated.reason.as_deref(), terminated.message.as_deref());
        }

        None
    })
}

fn state_diagnostic(name: &str, reason: Option<&str>, message: Option<&str>) -> Option<String> {
    reason
        .filter(|reason| !reason.is_empty())
        .or_else(|| message.filter(|message| !message.is_empty()))
        .map(|detail| format!("{name} {detail}"))
}

fn pod_has_critical_container_state(statuses: Option<&[ContainerStatus]>) -> bool {
    const CRITICAL_REASONS: &[&str] = &[
        "CrashLoopBackOff",
        "CreateContainerConfigError",
        "CreateContainerError",
        "ErrImagePull",
        "ImagePullBackOff",
        "InvalidImageName",
        "RunContainerError",
    ];

    statuses.unwrap_or_default().iter().any(|container| {
        container
            .state
            .as_ref()
            .and_then(|state| state.waiting.as_ref())
            .and_then(|waiting| waiting.reason.as_deref())
            .is_some_and(|reason| CRITICAL_REASONS.contains(&reason))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use k8s_openapi::api::autoscaling::v2::{HorizontalPodAutoscalerCondition, HorizontalPodAutoscalerStatus};
    use k8s_openapi::api::core::v1::{
        ConfigMapEnvSource, ConfigMapKeySelector, ConfigMapVolumeSource, Container, ContainerState,
        ContainerStateWaiting, EnvFromSource, EnvVar, EnvVarSource, LocalObjectReference, ObjectReference,
        PersistentVolumeClaimVolumeSource, PodSpec, PodStatus, SecretEnvSource, SecretKeySelector, SecretVolumeSource, Volume,
    };
    use k8s_openapi::api::discovery::v1::{Endpoint, EndpointConditions, EndpointSlice};
    use k8s_openapi::api::networking::v1::{
        HTTPIngressPath, HTTPIngressRuleValue, IngressBackend, IngressRule, IngressServiceBackend,
        IngressSpec, NetworkPolicySpec, ServiceBackendPort,
    };
    use k8s_openapi::apimachinery::pkg::apis::meta::v1::{LabelSelector, LabelSelectorRequirement, OwnerReference};

    #[test]
    fn running_ready_pod_without_restarts_is_healthy() {
        let pod = pod_with_status("Running", vec![container_status(true, 0, None)]);

        assert_eq!(pod_status(&pod, 0), HealthState::Healthy);
    }

    #[test]
    fn owner_label_preserves_controller_lineage() {
        let metadata = ObjectMeta {
            owner_references: Some(vec![OwnerReference {
                api_version: "batch/v1".to_string(),
                kind: "CronJob".to_string(),
                name: "nightly-reconcile".to_string(),
                uid: "uid-1".to_string(),
                ..OwnerReference::default()
            }]),
            ..ObjectMeta::default()
        };

        assert_eq!(owner_label(&metadata), "CronJob/nightly-reconcile");
    }

    #[test]
    fn running_crashlooping_pod_is_critical() {
        let pod = pod_with_status(
            "Running",
            vec![container_status(false, 5, Some("CrashLoopBackOff"))],
        );

        assert_eq!(pod_status(&pod, 5), HealthState::Critical);
    }

    #[test]
    fn pod_diagnostic_reports_current_container_reason() {
        let pod = pod_with_status(
            "Running",
            vec![container_status(false, 5, Some("CrashLoopBackOff"))],
        );

        assert_eq!(pod_diagnostic(&pod), "container CrashLoopBackOff");
    }

    #[test]
    fn running_init_crashlooping_pod_is_critical() {
        let mut pod = pod_with_status("Running", vec![container_status(false, 0, None)]);
        if let Some(status) = pod.status.as_mut() {
            status.init_container_statuses =
                Some(vec![container_status(false, 3, Some("ImagePullBackOff"))]);
        }

        assert_eq!(pod_status(&pod, 3), HealthState::Critical);
    }

    #[test]
    fn pod_diagnostic_prefers_init_container_reason() {
        let mut pod = pod_with_status("Running", vec![container_status(false, 0, None)]);
        if let Some(status) = pod.status.as_mut() {
            status.init_container_statuses =
                Some(vec![container_status(false, 3, Some("ImagePullBackOff"))]);
        }

        assert_eq!(pod_diagnostic(&pod), "container ImagePullBackOff");
    }

    #[test]
    fn workload_diagnostic_reports_only_degraded_readiness() {
        assert_eq!(workload_status(0, 3), HealthState::Critical);
        assert_eq!(workload_diagnostic(0, 3), "0/3 ready");
        assert_eq!(workload_status(2, 3), HealthState::Warning);
        assert_eq!(workload_diagnostic(2, 3), "2/3 ready");
        assert_eq!(workload_status(3, 3), HealthState::Healthy);
        assert_eq!(workload_diagnostic(3, 3), "");
        assert_eq!(workload_status(0, 0), HealthState::Healthy);
        assert_eq!(workload_diagnostic(0, 0), "");
    }

    #[test]
    fn hpa_status_reports_blocked_scaling_target() {
        let hpa = hpa_with_status(
            2,
            2,
            vec![HorizontalPodAutoscalerCondition {
                type_: "ScalingActive".to_string(),
                status: "False".to_string(),
                reason: Some("FailedGetScale".to_string()),
                message: Some("target missing".to_string()),
                ..HorizontalPodAutoscalerCondition::default()
            }],
        );

        assert_eq!(hpa_status(&hpa), HealthState::Critical);
        assert_eq!(hpa_diagnostic(&hpa, 2, 2), "target missing");
    }

    #[test]
    fn hpa_status_reports_replica_drift() {
        let hpa = hpa_with_status(1, 3, Vec::new());

        assert_eq!(hpa_status(&hpa), HealthState::Warning);
        assert_eq!(hpa_diagnostic(&hpa, 1, 3), "1/3 replicas");
    }

    #[test]
    fn running_unready_pod_is_warning() {
        let pod = pod_with_status("Running", vec![container_status(false, 0, None)]);

        assert_eq!(pod_status(&pod, 0), HealthState::Warning);
    }

    #[test]
    fn event_selector_scopes_to_resource_kind_and_name() {
        let target = ActionTarget {
            kind: "Pod".to_string(),
            name: "api".to_string(),
            namespace: "default".to_string(),
            cluster: "kind-kite".to_string(),
        };

        assert_eq!(event_field_selector(&target), "involvedObject.name=api,involvedObject.kind=Pod");
    }

    #[test]
    fn role_binding_subject_references_default_service_accounts_to_binding_namespace() {
        let subjects = vec![
            Subject {
                kind: "ServiceAccount".to_string(),
                name: "api".to_string(),
                namespace: None,
                ..Subject::default()
            },
            Subject {
                kind: "User".to_string(),
                name: "alice@example.com".to_string(),
                namespace: None,
                ..Subject::default()
            },
        ];

        let references = binding_subject_references(Some(&subjects), "payments");

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].kind, "ServiceAccount");
        assert_eq!(references[0].namespace, "payments");
        assert_eq!(references[0].name, "api");
    }

    #[test]
    fn cluster_role_binding_subject_references_require_service_account_namespace() {
        let subjects = vec![
            Subject {
                kind: "ServiceAccount".to_string(),
                name: "controller".to_string(),
                namespace: Some("ops".to_string()),
                ..Subject::default()
            },
            Subject {
                kind: "ServiceAccount".to_string(),
                name: "missing-namespace".to_string(),
                namespace: None,
                ..Subject::default()
            },
        ];

        let references = binding_subject_references(Some(&subjects), "cluster");

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].kind, "ServiceAccount");
        assert_eq!(references[0].namespace, "ops");
        assert_eq!(references[0].name, "controller");
    }

    #[test]
    fn command_candidates_include_gui_app_binary_locations() {
        let candidates = candidate_command_paths("kubectl");

        assert!(candidates.contains(&PathBuf::from("/opt/homebrew/bin/kubectl")));
        assert!(candidates.contains(&PathBuf::from("/usr/local/bin/kubectl")));
    }

    #[test]
    fn container_ports_reads_declared_pod_ports() {
        let container = serde_json::json!({
            "ports": [
                { "containerPort": 8080 },
                { "containerPort": 8443 },
                { "containerPort": 0 }
            ]
        });

        assert_eq!(container_ports(&container), vec![8080, 8443]);
    }

    #[test]
    fn pod_container_details_include_spec_only_containers() {
        let status = serde_json::json!({
            "containerStatuses": [{
                "name": "api",
                "image": "registry.example/api:ready",
                "ready": true,
                "restartCount": 1,
                "state": { "running": {} }
            }]
        });
        let spec = serde_json::json!({
            "containers": [
                {
                    "name": "api",
                    "image": "registry.example/api:declared",
                    "ports": [{ "containerPort": 8080 }],
                    "readinessProbe": {
                        "httpGet": { "path": "/ready", "port": 8080 }
                    },
                    "livenessProbe": {
                        "tcpSocket": { "port": "admin" }
                    },
                    "resources": {
                        "requests": { "cpu": "250m", "memory": "256Mi" },
                        "limits": { "cpu": "1", "memory": "512Mi", "nvidia.com/gpu": "1" }
                    }
                },
                {
                    "name": "worker",
                    "image": "registry.example/worker:pending",
                    "ports": [{ "containerPort": 9090 }]
                }
            ]
        });

        let containers =
            container_status_details(&status, &spec, "containerStatuses", "containers", "app");

        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].name, "api");
        assert_eq!(containers[0].image, "registry.example/api:ready");
        assert_eq!(containers[0].ports, vec![8080]);
        assert_eq!(containers[0].probes.len(), 2);
        assert_eq!(containers[0].probes[0].kind, "readiness");
        assert_eq!(containers[0].probes[0].check, "http /ready:8080");
        assert_eq!(containers[0].probes[1].kind, "liveness");
        assert_eq!(containers[0].probes[1].check, "tcp admin");
        assert_eq!(containers[0].requests.get("cpu").map(String::as_str), Some("250m"));
        assert_eq!(containers[0].requests.get("memory").map(String::as_str), Some("256Mi"));
        assert_eq!(containers[0].limits.get("cpu").map(String::as_str), Some("1"));
        assert_eq!(containers[0].limits.get("memory").map(String::as_str), Some("512Mi"));
        assert_eq!(containers[0].limits.get("nvidia.com/gpu").map(String::as_str), Some("1"));
        assert_eq!(containers[0].restart_count, 1);
        assert_eq!(containers[1].name, "worker");
        assert_eq!(containers[1].image, "registry.example/worker:pending");
        assert_eq!(containers[1].ports, vec![9090]);
        assert_eq!(containers[1].state, "pending");
        assert_eq!(containers[1].reason, "status pending");
    }

    #[test]
    fn pod_container_details_include_lifecycle_times() {
        let status = serde_json::json!({
            "containerStatuses": [{
                "name": "api",
                "image": "registry.example/api:ready",
                "ready": true,
                "restartCount": 1,
                "state": {
                    "running": { "startedAt": "2026-04-30T12:01:02Z" }
                },
                "lastState": {
                    "terminated": {
                        "reason": "Completed",
                        "exitCode": 0,
                        "startedAt": "2026-04-30T11:58:00Z",
                        "finishedAt": "2026-04-30T12:00:00Z"
                    }
                }
            }]
        });
        let spec = serde_json::json!({
            "containers": [{ "name": "api" }]
        });

        let containers =
            container_status_details(&status, &spec, "containerStatuses", "containers", "app");

        assert_eq!(containers[0].started_at, "2026-04-30T12:01:02Z");
        assert_eq!(containers[0].finished_at, "");
        assert_eq!(containers[0].last_started_at, "2026-04-30T11:58:00Z");
        assert_eq!(containers[0].last_finished_at, "2026-04-30T12:00:00Z");
    }

    #[test]
    fn previous_log_container_names_only_targets_restarted_containers() {
        let status = serde_json::json!({
            "phase": "Running",
            "containerStatuses": [
                {
                    "name": "api",
                    "image": "registry.example/api:ready",
                    "ready": false,
                    "restartCount": 2,
                    "state": { "waiting": { "reason": "CrashLoopBackOff" } },
                    "lastState": {
                        "terminated": {
                            "reason": "Error",
                            "exitCode": 1,
                            "startedAt": "2026-04-30T11:58:00Z",
                            "finishedAt": "2026-04-30T12:00:00Z"
                        }
                    }
                },
                {
                    "name": "worker",
                    "image": "registry.example/worker:ready",
                    "ready": true,
                    "restartCount": 0,
                    "state": { "running": {} }
                }
            ]
        });
        let spec = serde_json::json!({
            "containers": [{ "name": "api" }, { "name": "worker" }]
        });
        let containers =
            container_status_details(&status, &spec, "containerStatuses", "containers", "app");
        let pod = PodDetails {
            phase: "Running".to_string(),
            reason: String::new(),
            message: String::new(),
            node_name: "kind-worker".to_string(),
            pod_ip: "10.0.0.12".to_string(),
            host_ip: "172.18.0.2".to_string(),
            qos_class: "Burstable".to_string(),
            start_time: "2026-04-30T11:57:00Z".to_string(),
            ready_containers: 1,
            total_containers: 2,
            conditions: Vec::new(),
            containers,
            scheduling: pod_scheduling(&serde_json::json!({})),
        };

        assert_eq!(previous_log_container_names(&pod), vec!["api".to_string()]);
    }

    #[test]
    fn previous_log_prefix_preserves_terminal_source_shape() {
        let target = ActionTarget {
            kind: "Pod".to_string(),
            name: "api-7f57c9".to_string(),
            namespace: "payments".to_string(),
            cluster: "kind-kite".to_string(),
        };

        assert_eq!(
            prefix_container_log_lines(&target, "api", "2026-04-30T12:00:00Z failed\nretrying\n"),
            "[api-7f57c9/api] 2026-04-30T12:00:00Z failed\n[api-7f57c9/api] retrying"
        );
    }

    #[test]
    fn pod_last_restart_at_uses_latest_terminated_time() {
        let status = serde_json::from_value::<PodStatus>(serde_json::json!({
            "initContainerStatuses": [{
                "name": "migrate",
                "restartCount": 1,
                "lastState": {
                    "terminated": {
                        "startedAt": "2026-04-30T10:58:00Z",
                        "finishedAt": "2026-04-30T11:00:00Z"
                    }
                }
            }],
            "containerStatuses": [{
                "name": "api",
                "restartCount": 3,
                "lastState": {
                    "terminated": {
                        "startedAt": "2026-04-30T11:58:00Z",
                        "finishedAt": "2026-04-30T12:00:00Z"
                    }
                }
            }]
        }))
        .expect("pod status");

        assert_eq!(pod_last_restart_at(&status), "2026-04-30T12:00:00Z");
    }

    #[test]
    fn pod_scheduling_summarizes_placement_inputs() {
        let spec = serde_json::json!({
            "nodeSelector": {
                "pool": "gpu",
                "dedicated": true
            },
            "priorityClassName": "critical",
            "schedulerName": "kite-scheduler",
            "serviceAccountName": "api",
            "runtimeClassName": "nvidia",
            "tolerations": [
                { "key": "dedicated", "operator": "Equal", "value": "gpu", "effect": "NoSchedule" },
                { "operator": "Exists", "effect": "NoExecute" }
            ],
            "affinity": {
                "nodeAffinity": {},
                "podAntiAffinity": {}
            },
            "schedulingGates": [
                { "name": "rollout.kite.dev/ready" }
            ]
        });

        let scheduling = pod_scheduling(&spec);

        assert_eq!(scheduling.node_selector.get("pool").map(String::as_str), Some("gpu"));
        assert_eq!(scheduling.node_selector.get("dedicated").map(String::as_str), Some("true"));
        assert_eq!(scheduling.priority_class_name, "critical");
        assert_eq!(scheduling.scheduler_name, "kite-scheduler");
        assert_eq!(scheduling.service_account_name, "api");
        assert_eq!(scheduling.runtime_class_name, "nvidia");
        assert_eq!(
            scheduling.tolerations,
            vec!["dedicated=gpu:NoSchedule".to_string(), "all:NoExecute".to_string()]
        );
        assert_eq!(scheduling.affinity, vec!["node".to_string(), "anti-pod".to_string()]);
        assert_eq!(scheduling.scheduling_gates, vec!["rollout.kite.dev/ready".to_string()]);
    }

    #[test]
    fn pod_port_forward_command_uses_random_local_port() {
        let target = ActionTarget {
            kind: "Pod".to_string(),
            name: "api".to_string(),
            namespace: "default".to_string(),
            cluster: "kind-kite".to_string(),
        };

        let command = pod_port_forward_command(&target, 8080);

        assert!(command.contains("kubectl --context kind-kite port-forward -n default pod/api :8080"));
    }

    #[test]
    fn pod_exec_command_targets_container_when_requested() {
        let target = ActionTarget {
            kind: "Pod".to_string(),
            name: "api".to_string(),
            namespace: "default".to_string(),
            cluster: "kind-kite".to_string(),
        };

        let command = pod_exec_command(&target, Some("sidecar"));

        assert!(command.contains("kubectl --context kind-kite exec -n default -it api -c sidecar -- /bin/sh"));
    }

    #[test]
    fn requested_port_for_action_reads_explicit_port() {
        assert_eq!(requested_port_for_action("port-forward:9090"), Ok(Some(9090)));
        assert_eq!(requested_port_for_action("port-forward"), Ok(None));
        assert_eq!(requested_port_for_action("exec:9090"), Ok(None));
        assert!(requested_port_for_action("port-forward:0").is_err());
        assert!(requested_port_for_action("port-forward:http").is_err());
    }

    #[test]
    fn requested_container_for_exec_action_reads_container_name() {
        assert_eq!(requested_container_for_exec_action("exec:sidecar"), Ok(Some("sidecar".to_string())));
        assert_eq!(requested_container_for_exec_action("exec"), Ok(None));
        assert_eq!(requested_container_for_exec_action("port-forward:8080"), Ok(None));
        assert!(requested_container_for_exec_action("exec:").is_err());
    }

    #[test]
    fn owner_ref_rejects_missing_owner_parts() {
        assert_eq!(owner_ref(""), None);
        assert_eq!(owner_ref("ReplicaSet/"), None);
        assert_eq!(owner_ref("/api-7f57c9"), None);
    }

    #[test]
    fn rollout_restart_args_use_verified_workload_owner() {
        let owner = owner_ref("Deployment/api").expect("deployment owner");

        assert_eq!(
            rollout_restart_args_for_owner(&owner, "default"),
            Ok(vec![
                "rollout".to_string(),
                "restart".to_string(),
                "deployment/api".to_string(),
                "-n".to_string(),
                "default".to_string(),
            ])
        );
    }

    #[test]
    fn rollout_restart_args_support_direct_workload_restart() {
        assert!(is_restartable_workload_kind("Deployment"));
        assert!(is_restartable_workload_kind("StatefulSet"));
        assert!(is_restartable_workload_kind("DaemonSet"));
        assert!(!is_restartable_workload_kind("ReplicaSet"));

        assert_eq!(
            rollout_restart_args("DaemonSet", "node-agent", "kube-system"),
            vec![
                "rollout".to_string(),
                "restart".to_string(),
                "daemonset/node-agent".to_string(),
                "-n".to_string(),
                "kube-system".to_string(),
            ]
        );
    }

    #[test]
    fn rollout_restart_args_block_plain_replicaset_owner() {
        let owner = owner_ref("ReplicaSet/api-7f57c9").expect("replicaset owner");

        assert_eq!(
            rollout_restart_args_for_owner(&owner, "default"),
            Err("Restart is not available for pods owned by ReplicaSet.".to_string())
        );
    }

    #[test]
    fn namespace_names_fall_back_to_resource_namespaces() {
        let resources = vec![
            resource_summary(
                "Pod",
                "api-74d9".to_string(),
                "prosights-local".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "api:latest".to_string(),
            ),
            resource_summary(
                "Service",
                "api".to_string(),
                "prosights-local".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "ClusterIP".to_string(),
            ),
            resource_summary(
                "Node",
                "kind-control-plane".to_string(),
                "cluster".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "kubelet".to_string(),
            ),
            resource_summary(
                "Namespace",
                "kube-system".to_string(),
                "cluster".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                String::new(),
            ),
        ];

        assert_eq!(
            namespace_names_for(&resources),
            vec!["kube-system".to_string(), "prosights-local".to_string()]
        );
    }

    #[test]
    fn network_policy_summary_uses_selector_and_default_policy_type() {
        let policy = NetworkPolicy {
            metadata: ObjectMeta {
                name: Some("default-deny".to_string()),
                namespace: Some("payments".to_string()),
                ..ObjectMeta::default()
            },
            spec: Some(NetworkPolicySpec {
                pod_selector: Some(LabelSelector {
                    match_labels: Some(BTreeMap::from([("app".to_string(), "api".to_string())])),
                    ..LabelSelector::default()
                }),
                ..NetworkPolicySpec::default()
            }),
        };

        assert_eq!(
            network_policy_selector(&policy),
            BTreeMap::from([("app".to_string(), "api".to_string())])
        );
        assert_eq!(network_policy_types(&policy), vec!["Ingress".to_string()]);
        assert_eq!(
            network_policy_selector_summary(&policy, &network_policy_selector(&policy)),
            "app=api"
        );
    }

    #[test]
    fn network_policy_empty_selector_summarizes_all_pods() {
        let policy = NetworkPolicy {
            metadata: ObjectMeta::default(),
            spec: Some(NetworkPolicySpec {
                pod_selector: Some(LabelSelector::default()),
                egress: Some(Vec::new()),
                ..NetworkPolicySpec::default()
            }),
        };

        assert!(network_policy_selector(&policy).is_empty());
        assert_eq!(network_policy_types(&policy), vec!["Ingress".to_string(), "Egress".to_string()]);
        assert_eq!(
            network_policy_selector_summary(&policy, &network_policy_selector(&policy)),
            "all pods"
        );
    }

    #[test]
    fn network_policy_expression_selector_does_not_claim_all_pods() {
        let policy = NetworkPolicy {
            metadata: ObjectMeta::default(),
            spec: Some(NetworkPolicySpec {
                pod_selector: Some(LabelSelector {
                    match_expressions: Some(vec![LabelSelectorRequirement {
                        key: "app".to_string(),
                        operator: "In".to_string(),
                        values: Some(vec!["api".to_string(), "worker".to_string()]),
                    }]),
                    ..LabelSelector::default()
                }),
                ..NetworkPolicySpec::default()
            }),
        };

        assert!(network_policy_selector(&policy).is_empty());
        assert_eq!(
            network_policy_selector_summary(&policy, &network_policy_selector(&policy)),
            "selector expression"
        );
    }

    #[test]
    fn event_timestamp_prefers_latest_available_event_time() {
        let event = serde_json::json!({
            "eventTime": "2026-04-28T21:10:00Z",
            "lastTimestamp": "2026-04-28T21:12:00Z",
            "metadata": {
                "creationTimestamp": "2026-04-28T21:08:00Z"
            }
        });

        assert_eq!(event_timestamp(&event), "2026-04-28T21:12:00Z");
        assert_eq!(event_age(&event), "2026-04-28");
    }

    #[test]
    fn resource_events_are_newest_first() {
        let items = vec![
            serde_json::json!({
                "type": "Normal",
                "reason": "Pulled",
                "lastTimestamp": "2026-04-28T21:10:00Z"
            }),
            serde_json::json!({
                "type": "Warning",
                "reason": "BackOff",
                "eventTime": "2026-04-28T21:12:00Z"
            }),
            serde_json::json!({
                "type": "Normal",
                "reason": "Scheduled",
                "metadata": {
                    "creationTimestamp": "2026-04-28T21:08:00Z"
                }
            }),
        ];

        let events = resource_events_from_items(&items);

        assert_eq!(
            events.iter().map(|event| event.reason.as_str()).collect::<Vec<_>>(),
            ["BackOff", "Pulled", "Scheduled"]
        );
    }

    #[test]
    fn resource_event_preserves_repeat_count() {
        let repeated = serde_json::json!({
            "type": "Warning",
            "reason": "BackOff",
            "message": "Back-off restarting failed container",
            "count": 7,
        });
        let missing_count = serde_json::json!({
            "type": "Normal",
            "reason": "Scheduled",
        });

        assert_eq!(resource_event(&repeated).count, 7);
        assert_eq!(resource_event(&missing_count).count, 1);
    }

    #[test]
    fn event_resource_details_returns_selected_event_payload() {
        let json = serde_json::json!({
            "type": "Warning",
            "reason": "FailedScheduling",
            "message": "0/3 nodes are available",
            "count": 2,
            "lastTimestamp": "2026-04-28T21:12:00Z"
        });

        let details = event_resource_details("kind: Event".to_string(), "Name: event".to_string(), &json.to_string());

        assert_eq!(details.yaml, "kind: Event");
        assert_eq!(details.describe, "Name: event");
        assert_eq!(details.events.len(), 1);
        assert_eq!(details.events[0].type_, "Warning");
        assert_eq!(details.events[0].reason, "FailedScheduling");
        assert_eq!(details.events[0].message, "0/3 nodes are available");
        assert_eq!(details.events[0].count, 2);
        assert_eq!(details.logs, "");
        assert!(details.pod.is_none());
    }

    #[test]
    fn warning_events_promote_involved_resource_signal() {
        let mut resources = vec![
            resource_summary(
                "Pod",
                "api".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "api:latest".to_string(),
            ),
            resource_summary(
                "Event",
                "api.17".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Warning,
                0,
                "Warning".to_string(),
            )
            .with_diagnostic("FailedScheduling".to_string())
            .with_references(vec![resource_reference("Pod", "payments", "api")]),
        ];

        annotate_warning_events(&mut resources);

        assert_eq!(resources[0].status, HealthState::Warning);
        assert_eq!(resources[0].diagnostic, "event FailedScheduling");
        assert_eq!(resources[0].cpu, 44);
        assert_eq!(resources[0].memory, 52);
    }

    #[test]
    fn warning_events_keep_existing_resource_diagnostics() {
        let mut resources = vec![
            resource_summary(
                "Pod",
                "api".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Critical,
                4,
                "api:latest".to_string(),
            )
            .with_diagnostic("container CrashLoopBackOff".to_string()),
            resource_summary(
                "Event",
                "api.17".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Warning,
                0,
                "Warning".to_string(),
            )
            .with_diagnostic("BackOff".to_string())
            .with_references(vec![resource_reference("Pod", "payments", "api")]),
        ];

        annotate_warning_events(&mut resources);

        assert_eq!(resources[0].status, HealthState::Critical);
        assert_eq!(resources[0].diagnostic, "container CrashLoopBackOff");
    }

    #[test]
    fn service_backend_annotation_marks_selector_without_pods_critical() {
        let mut resources = vec![
            resource_summary(
                "Service",
                "api".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "ClusterIP".to_string(),
            )
            .with_selector(BTreeMap::from([("app".to_string(), "api".to_string())])),
            resource_summary(
                "Pod",
                "worker".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "worker:latest".to_string(),
            )
            .with_labels(BTreeMap::from([("app".to_string(), "worker".to_string())])),
        ];

        annotate_service_backends(&mut resources);

        assert_eq!(resources[0].status, HealthState::Critical);
        assert_eq!(resources[0].diagnostic, "no selected pods");
    }

    #[test]
    fn service_backend_annotation_reports_partial_pod_readiness() {
        let mut resources = vec![
            resource_summary(
                "Service",
                "api".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "ClusterIP".to_string(),
            )
            .with_selector(BTreeMap::from([("app".to_string(), "api".to_string())])),
            resource_summary(
                "Pod",
                "api-ready".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "api:latest".to_string(),
            )
            .with_labels(BTreeMap::from([("app".to_string(), "api".to_string())]))
            .with_backend_ready(true),
            resource_summary(
                "Pod",
                "api-crash".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Critical,
                4,
                "api:latest".to_string(),
            )
            .with_labels(BTreeMap::from([("app".to_string(), "api".to_string())])),
        ];

        annotate_service_backends(&mut resources);

        assert_eq!(resources[0].status, HealthState::Warning);
        assert_eq!(resources[0].diagnostic, "1/2 backend pods ready");
    }

    #[test]
    fn service_backend_annotation_treats_restarted_ready_pods_as_ready() {
        let mut resources = vec![
            resource_summary(
                "Service",
                "api".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "ClusterIP".to_string(),
            )
            .with_selector(BTreeMap::from([("app".to_string(), "api".to_string())])),
            resource_summary(
                "Pod",
                "api-ready".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Warning,
                3,
                "api:latest".to_string(),
            )
            .with_labels(BTreeMap::from([("app".to_string(), "api".to_string())]))
            .with_backend_ready(true),
        ];

        annotate_service_backends(&mut resources);

        assert_eq!(resources[0].status, HealthState::Healthy);
        assert_eq!(resources[0].diagnostic, "");
    }

    #[test]
    fn service_backend_annotation_marks_selectorless_service_without_endpoint_slices_critical() {
        let mut resources = vec![resource_summary(
            "Service",
            "manual-api".to_string(),
            "payments".to_string(),
            "kind-kite",
            HealthState::Healthy,
            0,
            "ClusterIP".to_string(),
        )];

        annotate_service_backends(&mut resources);

        assert_eq!(resources[0].status, HealthState::Critical);
        assert_eq!(resources[0].diagnostic, "no endpoint slices");
    }

    #[test]
    fn service_backend_annotation_does_not_require_endpoint_slices_for_external_name() {
        let mut resources = vec![resource_summary(
            "Service",
            "vendor-api".to_string(),
            "payments".to_string(),
            "kind-kite",
            HealthState::Healthy,
            0,
            "ExternalName".to_string(),
        )];

        annotate_service_backends(&mut resources);

        assert_eq!(resources[0].status, HealthState::Healthy);
        assert_eq!(resources[0].diagnostic, "");
    }

    #[test]
    fn service_backend_annotation_uses_endpoint_slice_readiness_for_selectorless_service() {
        let slice = endpoint_slice(
            "manual-api-abcd",
            "payments",
            "manual-api",
            vec![
                endpoint_ref("api-ready", true),
                endpoint_ref("api-draining", false),
            ],
        );
        let mut resources = vec![
            resource_summary(
                "Service",
                "manual-api".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "ClusterIP".to_string(),
            ),
            endpoint_slice_summary(slice, "kind-kite"),
        ];

        annotate_service_backends(&mut resources);

        assert_eq!(resources[0].status, HealthState::Warning);
        assert_eq!(resources[0].diagnostic, "1/2 endpoints ready");
    }

    #[test]
    fn service_backend_annotation_promotes_ready_pod_service_when_endpoint_slices_are_degraded() {
        let slice = endpoint_slice("api-empty", "payments", "api", Vec::new());
        let mut resources = vec![
            resource_summary(
                "Service",
                "api".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "ClusterIP".to_string(),
            )
            .with_selector(BTreeMap::from([("app".to_string(), "api".to_string())])),
            resource_summary(
                "Pod",
                "api-ready".to_string(),
                "payments".to_string(),
                "kind-kite",
                HealthState::Healthy,
                0,
                "api:latest".to_string(),
            )
            .with_labels(BTreeMap::from([("app".to_string(), "api".to_string())]))
            .with_backend_ready(true),
            endpoint_slice_summary(slice, "kind-kite"),
        ];

        annotate_service_backends(&mut resources);

        assert_eq!(resources[0].status, HealthState::Critical);
        assert_eq!(resources[0].diagnostic, "no endpoints");
    }

    #[test]
    fn endpoint_slice_summary_links_service_and_target_pods() {
        let slice = endpoint_slice(
            "api-abcd",
            "payments",
            "api",
            vec![
                endpoint_ref("api-ready", true),
                endpoint_ref("api-draining", false),
            ],
        );

        let summary = endpoint_slice_summary(slice, "kind-kite");

        assert_eq!(summary.kind, "EndpointSlice");
        assert_eq!(summary.namespace, "payments");
        assert_eq!(summary.owner, "Service/api");
        assert_eq!(summary.status, HealthState::Warning);
        assert_eq!(summary.diagnostic, "1/2 endpoints ready");
        assert_eq!(summary.references.len(), 3);
        assert_eq!(summary.references[0].kind, "Service");
        assert_eq!(summary.references[0].name, "api");
        assert_eq!(summary.references[1].kind, "Pod");
        assert_eq!(summary.references[1].name, "api-ready");
    }

    #[test]
    fn endpoint_slice_without_endpoints_is_critical() {
        let slice = endpoint_slice("api-empty", "payments", "api", Vec::new());

        let summary = endpoint_slice_summary(slice, "kind-kite");

        assert_eq!(summary.status, HealthState::Critical);
        assert_eq!(summary.diagnostic, "no endpoints");
    }

    #[test]
    fn gateway_api_status_uses_nested_route_conditions() {
        let route = serde_json::json!({
            "spec": {
                "hostnames": ["api.kite.local"],
                "parentRefs": [{ "name": "edge" }]
            },
            "status": {
                "parents": [{
                    "conditions": [
                        { "type": "Accepted", "status": "True" },
                        { "type": "ResolvedRefs", "status": "False" }
                    ]
                }]
            }
        });

        assert_eq!(gateway_api_status(&route), HealthState::Warning);
        assert_eq!(gateway_api_owner("HTTPRoute", &route), "edge");
        assert_eq!(gateway_api_summary("HTTPRoute", &route), "api.kite.local");
    }

    #[test]
    fn gateway_api_status_syncs_until_conditions_arrive() {
        let gateway = serde_json::json!({
            "spec": {
                "gatewayClassName": "nginx",
                "listeners": [{ "hostname": "kite.local" }]
            }
        });

        assert_eq!(gateway_api_status(&gateway), HealthState::Syncing);
        assert_eq!(gateway_api_owner("Gateway", &gateway), "nginx");
        assert_eq!(gateway_api_summary("Gateway", &gateway), "kite.local");
    }

    #[test]
    fn gateway_api_status_respects_condition_polarity() {
        let gateway = serde_json::json!({
            "status": {
                "conditions": [
                    { "type": "Accepted", "status": "True" },
                    { "type": "Programmed", "status": "True" },
                    { "type": "Conflicted", "status": "False" }
                ]
            }
        });

        assert_eq!(gateway_api_status(&gateway), HealthState::Healthy);
    }

    #[test]
    fn http_route_references_backend_services() {
        let route = serde_json::json!({
            "spec": {
                "rules": [{
                    "backendRefs": [
                        { "name": "api" },
                        { "kind": "Service", "namespace": "shared", "name": "payments" },
                        { "group": "gateway.networking.k8s.io", "kind": "HTTPRoute", "name": "delegate" },
                        { "name": "api" }
                    ]
                }]
            }
        });

        let references = gateway_api_backend_references("HTTPRoute", &route, "default");

        assert_eq!(references.len(), 2);
        assert_eq!(references[0].kind, "Service");
        assert_eq!(references[0].namespace, "default");
        assert_eq!(references[0].name, "api");
        assert_eq!(references[1].namespace, "shared");
        assert_eq!(references[1].name, "payments");
    }

    #[test]
    fn ingress_references_backend_services() {
        let ingress = Ingress {
            spec: Some(IngressSpec {
                default_backend: Some(ingress_backend("edge")),
                rules: Some(vec![IngressRule {
                    http: Some(HTTPIngressRuleValue {
                        paths: vec![
                            HTTPIngressPath {
                                backend: ingress_backend("api"),
                                path: Some("/api".to_string()),
                                path_type: "Prefix".to_string(),
                            },
                            HTTPIngressPath {
                                backend: ingress_backend("edge"),
                                path: Some("/".to_string()),
                                path_type: "Prefix".to_string(),
                            },
                        ],
                    }),
                    ..IngressRule::default()
                }]),
                ..IngressSpec::default()
            }),
            ..Ingress::default()
        };

        let references = ingress_backend_references(&ingress, "default");

        assert_eq!(references.len(), 2);
        assert_eq!(references[0].name, "edge");
        assert_eq!(references[1].name, "api");
        assert!(references.iter().all(|reference| reference.kind == "Service"));
    }

    #[test]
    fn pod_dependency_references_track_mounted_and_env_resources() {
        let mut pod = Pod::default();
        pod.spec = Some(PodSpec {
            service_account_name: Some("api-sa".to_string()),
            image_pull_secrets: Some(vec![LocalObjectReference {
                name: "registry-creds".to_string(),
            }]),
            containers: vec![Container {
                name: "api".to_string(),
                env_from: Some(vec![
                    EnvFromSource {
                        config_map_ref: Some(ConfigMapEnvSource {
                            name: "app-config".to_string(),
                            ..ConfigMapEnvSource::default()
                        }),
                        ..EnvFromSource::default()
                    },
                    EnvFromSource {
                        secret_ref: Some(SecretEnvSource {
                            name: "env-secret".to_string(),
                            ..SecretEnvSource::default()
                        }),
                        ..EnvFromSource::default()
                    },
                ]),
                env: Some(vec![
                    EnvVar {
                        name: "FEATURE_FLAG".to_string(),
                        value_from: Some(EnvVarSource {
                            config_map_key_ref: Some(ConfigMapKeySelector {
                                key: "flag".to_string(),
                                name: "feature-config".to_string(),
                                ..ConfigMapKeySelector::default()
                            }),
                            ..EnvVarSource::default()
                        }),
                        ..EnvVar::default()
                    },
                    EnvVar {
                        name: "TOKEN".to_string(),
                        value_from: Some(EnvVarSource {
                            secret_key_ref: Some(SecretKeySelector {
                                key: "token".to_string(),
                                name: "app-secret".to_string(),
                                ..SecretKeySelector::default()
                            }),
                            ..EnvVarSource::default()
                        }),
                        ..EnvVar::default()
                    },
                ]),
                ..Container::default()
            }],
            volumes: Some(vec![
                Volume {
                    config_map: Some(ConfigMapVolumeSource {
                        name: "app-config".to_string(),
                        ..ConfigMapVolumeSource::default()
                    }),
                    ..Volume::default()
                },
                Volume {
                    secret: Some(SecretVolumeSource {
                        secret_name: Some("app-secret".to_string()),
                        ..SecretVolumeSource::default()
                    }),
                    ..Volume::default()
                },
                Volume {
                    persistent_volume_claim: Some(PersistentVolumeClaimVolumeSource {
                        claim_name: "app-data".to_string(),
                        ..PersistentVolumeClaimVolumeSource::default()
                    }),
                    ..Volume::default()
                },
            ]),
            ..PodSpec::default()
        });

        let references = pod_dependency_references(&pod, "default");

        assert_eq!(references.len(), 7);
        assert_eq!(references[0].kind, "ConfigMap");
        assert_eq!(references[0].name, "app-config");
        assert_eq!(references[1].kind, "Secret");
        assert_eq!(references[1].name, "app-secret");
        assert_eq!(references[2].kind, "PersistentVolumeClaim");
        assert_eq!(references[2].name, "app-data");
        assert_eq!(references[3].kind, "ServiceAccount");
        assert_eq!(references[3].name, "api-sa");
        assert_eq!(references[4].kind, "Secret");
        assert_eq!(references[4].name, "registry-creds");
        assert_eq!(references[5].kind, "Secret");
        assert_eq!(references[5].name, "env-secret");
        assert_eq!(references[6].kind, "ConfigMap");
        assert_eq!(references[6].name, "feature-config");
    }

    #[test]
    fn event_involved_references_track_affected_resource() {
        let event = Event {
            involved_object: ObjectReference {
                kind: Some("Pod".to_string()),
                name: Some("api-7d9f".to_string()),
                namespace: Some("payments".to_string()),
                ..ObjectReference::default()
            },
            ..Event::default()
        };

        let references = event_involved_references(&event, "default");

        assert_eq!(references.len(), 1);
        assert_eq!(references[0].kind, "Pod");
        assert_eq!(references[0].namespace, "payments");
        assert_eq!(references[0].name, "api-7d9f");
    }

    #[test]
    fn namespace_heat_keeps_all_namespaces_before_ui_ranking() {
        let namespaces = (0..12)
            .map(|index| format!("ns-{index:02}"))
            .collect::<Vec<_>>();
        let resources = vec![resource_summary(
            "Pod",
            "api".to_string(),
            "ns-11".to_string(),
            "kind-kite",
            HealthState::Healthy,
            7,
            String::new(),
        )];

        let heat = namespace_heat_for_namespaces(&namespaces, &resources);
        let risky_namespace = heat
            .iter()
            .find(|item| item.namespace == "ns-11")
            .expect("late namespace heat");

        assert_eq!(heat.len(), 12);
        assert_eq!(risky_namespace.restarts, 7);
        assert_eq!(risky_namespace.risk, HealthState::Critical);
    }

    fn pod_with_status(phase: &str, containers: Vec<ContainerStatus>) -> Pod {
        Pod {
            status: Some(PodStatus {
                phase: Some(phase.to_string()),
                container_statuses: Some(containers),
                ..PodStatus::default()
            }),
            ..Pod::default()
        }
    }

    fn hpa_with_status(current_replicas: i32, desired_replicas: i32, conditions: Vec<HorizontalPodAutoscalerCondition>) -> HorizontalPodAutoscaler {
        HorizontalPodAutoscaler {
            status: Some(HorizontalPodAutoscalerStatus {
                current_replicas: Some(current_replicas),
                desired_replicas,
                conditions: Some(conditions),
                ..HorizontalPodAutoscalerStatus::default()
            }),
            ..HorizontalPodAutoscaler::default()
        }
    }

    fn container_status(ready: bool, restart_count: i32, waiting_reason: Option<&str>) -> ContainerStatus {
        ContainerStatus {
            ready,
            restart_count,
            state: waiting_reason.map(|reason| ContainerState {
                waiting: Some(ContainerStateWaiting {
                    reason: Some(reason.to_string()),
                    ..ContainerStateWaiting::default()
                }),
                ..ContainerState::default()
            }),
            ..ContainerStatus::default()
        }
    }

    fn ingress_backend(service: &str) -> IngressBackend {
        IngressBackend {
            service: Some(IngressServiceBackend {
                name: service.to_string(),
                port: Some(ServiceBackendPort {
                    number: Some(80),
                    ..ServiceBackendPort::default()
                }),
            }),
            ..IngressBackend::default()
        }
    }

    fn endpoint_slice(name: &str, namespace: &str, service: &str, endpoints: Vec<Endpoint>) -> EndpointSlice {
        EndpointSlice {
            address_type: "IPv4".to_string(),
            endpoints,
            metadata: ObjectMeta {
                name: Some(name.to_string()),
                namespace: Some(namespace.to_string()),
                labels: Some(BTreeMap::from([(
                    "kubernetes.io/service-name".to_string(),
                    service.to_string(),
                )])),
                ..ObjectMeta::default()
            },
            ports: None,
        }
    }

    fn endpoint_ref(name: &str, ready: bool) -> Endpoint {
        Endpoint {
            addresses: vec!["10.42.0.10".to_string()],
            conditions: Some(EndpointConditions {
                ready: Some(ready),
                serving: Some(ready),
                terminating: Some(!ready),
            }),
            target_ref: Some(ObjectReference {
                kind: Some("Pod".to_string()),
                namespace: Some("payments".to_string()),
                name: Some(name.to_string()),
                ..ObjectReference::default()
            }),
            ..Endpoint::default()
        }
    }
}

trait ResourceSummaryPatch {
    fn with_owner(self, owner: String) -> Self;
    fn with_age(self, age: String) -> Self;
    fn with_backend_ready(self, backend_ready: bool) -> Self;
    fn with_diagnostic(self, diagnostic: String) -> Self;
    fn with_labels(self, labels: BTreeMap<String, String>) -> Self;
    fn with_last_restart_at(self, last_restart_at: String) -> Self;
    fn with_node_name(self, node_name: String) -> Self;
    fn with_references(self, references: Vec<ResourceReference>) -> Self;
    fn with_selector(self, selector: BTreeMap<String, String>) -> Self;
}

impl ResourceSummaryPatch for ResourceSummary {
    fn with_owner(mut self, owner: String) -> Self {
        self.owner = owner;
        self
    }

    fn with_age(mut self, age: String) -> Self {
        self.age = age;
        self
    }

    fn with_backend_ready(mut self, backend_ready: bool) -> Self {
        self.backend_ready = backend_ready;
        self
    }

    fn with_diagnostic(mut self, diagnostic: String) -> Self {
        self.diagnostic = diagnostic;
        self
    }

    fn with_labels(mut self, labels: BTreeMap<String, String>) -> Self {
        self.labels = labels;
        self
    }

    fn with_last_restart_at(mut self, last_restart_at: String) -> Self {
        self.last_restart_at = last_restart_at;
        self
    }

    fn with_node_name(mut self, node_name: String) -> Self {
        self.node_name = node_name;
        self
    }

    fn with_references(mut self, references: Vec<ResourceReference>) -> Self {
        self.references = references;
        self
    }

    fn with_selector(mut self, selector: BTreeMap<String, String>) -> Self {
        self.selector = selector;
        self
    }
}

fn namespace_heat(namespace: &str, resources: &[ResourceSummary]) -> NamespaceHeat {
    let scoped = resources
        .iter()
        .filter(|resource| resource.namespace == namespace)
        .collect::<Vec<_>>();
    let restarts = scoped.iter().map(|resource| resource.restarts).sum::<u32>();
    let max_pressure = scoped
        .iter()
        .map(|resource| resource.cpu.max(resource.memory))
        .max()
        .unwrap_or(0);

    NamespaceHeat {
        namespace: namespace.to_string(),
        cpu: max_pressure,
        memory: max_pressure.saturating_add(restarts.min(100) as u8).min(100),
        restarts,
        risk: if restarts > 5 {
            HealthState::Critical
        } else if max_pressure > 45 {
            HealthState::Warning
        } else {
            HealthState::Healthy
        },
    }
}

fn namespace_heat_for_namespaces(
    namespaces: &[String],
    resources: &[ResourceSummary],
) -> Vec<NamespaceHeat> {
    namespaces
        .iter()
        .map(|namespace| namespace_heat(namespace, resources))
        .collect()
}
