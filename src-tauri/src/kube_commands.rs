use std::collections::BTreeMap;

use k8s_openapi::api::{
    apps::v1::{DaemonSet, Deployment, StatefulSet},
    batch::v1::{CronJob, Job},
    core::v1::{Event, Namespace, Node, Pod, Service},
};
use k8s_openapi::apiextensions_apiserver::pkg::apis::apiextensions::v1::CustomResourceDefinition;
use kube::{
    api::ListParams,
    config::{Config, KubeConfigOptions, Kubeconfig},
    Api, Client, ResourceExt,
};
use serde::Deserialize;

use crate::models::{
    ActionPreview, ActionRisk, ActionTarget, ClusterSummary, ContainerDetails, HealthState, KubeContextSummary, LiveSnapshot,
    NamespaceHeat, PodActionResult, PodActionStatus, PodCondition, PodDetails, ResourceDetails, ResourceEvent, ResourceSummary,
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

    let namespaces = Api::<Namespace>::all(client.clone())
        .list(&ListParams::default())
        .await
        .map_err(|error| format!("Unable to list namespaces: {error}"))?
        .items
        .into_iter()
        .filter_map(|namespace| namespace.metadata.name)
        .collect::<Vec<_>>();

    let mut resources = Vec::new();
    resources.extend(list_pods(client.clone(), &context).await?);
    resources.extend(list_deployments(client.clone(), &context).await?);
    resources.extend(list_statefulsets(client.clone(), &context).await?);
    resources.extend(list_daemonsets(client.clone(), &context).await?);
    resources.extend(list_jobs(client.clone(), &context).await?);
    resources.extend(list_cronjobs(client.clone(), &context).await?);
    resources.extend(list_services(client.clone(), &context).await?);
    resources.extend(list_events(client.clone(), &context).await?);
    resources.extend(list_nodes(client.clone(), &context).await?);
    resources.extend(list_namespaces(client.clone(), &context).await?);
    resources.extend(list_crds(client.clone(), &context).await?);
    resources.extend(list_helm_releases(&context).await.unwrap_or_default());

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
        namespace_heat: namespaces
            .into_iter()
            .take(10)
            .map(|namespace| namespace_heat(&namespace, &resources))
            .collect(),
        resources,
    })
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

    let yaml = kubectl(resource_yaml_args(&target))
        .await
        .unwrap_or_else(|error| error);
    let events = resource_events(&target).await.unwrap_or_default();
    let pod = if target.kind == "Pod" {
        pod_details(&target).await.ok()
    } else {
        None
    };
    let logs = if target.kind == "Pod" {
        pod_logs(&target).await.unwrap_or_else(|error| error)
    } else {
        String::new()
    };

    ResourceDetails { yaml, events, logs, pod }
}

#[tauri::command]
pub async fn pod_action(action: String, target: ActionTarget, confirmed: bool) -> PodActionResult {
    let normalized = action.to_lowercase();
    if target.kind != "Pod" {
        return pod_action_result(
            normalized,
            PodActionStatus::Blocked,
            "Pod actions only run against pods.".to_string(),
            String::new(),
            String::new(),
            false,
        );
    }

    let is_local = is_local_context(&target.cluster);
    match normalized.as_str() {
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
            match pod_logs(&target).await
            {
                Ok(output) => pod_action_result(normalized, PodActionStatus::Executed, "Read latest pod logs.".to_string(), output, command, false),
                Err(error) => pod_action_result(normalized, PodActionStatus::Failed, error, String::new(), command, false),
            }
        }
        "exec" => {
            let command = pod_exec_command(&target);
            match open_terminal(&command).await {
                Ok(()) => pod_action_result(
                    normalized,
                    PodActionStatus::Executed,
                    "Opened Terminal with an interactive pod shell.".to_string(),
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
        events: if status.is_empty() {
            Vec::new()
        } else {
            vec![ResourceEvent {
                type_: "Normal".to_string(),
                reason: "HelmStatus".to_string(),
                message: status,
                age: "live".to_string(),
            }]
        },
        logs: String::new(),
        pod: None,
    }
}

async fn pod_logs(target: &ActionTarget) -> Result<String, String> {
    kubectl(kubectl_target_args(
        target,
        vec![
            "logs".to_string(),
            target.name.clone(),
            "-n".to_string(),
            target.namespace.clone(),
            "--all-containers=true".to_string(),
            "--prefix=true".to_string(),
            "--tail=240".to_string(),
            "--timestamps".to_string(),
        ],
    ))
    .await
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
    let containers = status
        .get("containerStatuses")
        .and_then(|value| value.as_array())
        .map(|items| items.iter().map(container_details).collect::<Vec<_>>())
        .unwrap_or_default();
    let ready_containers = containers.iter().filter(|container| container.ready).count();
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
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(PodDetails {
        phase: text_field(status, "phase", "Unknown"),
        node_name: text_field(spec, "nodeName", ""),
        pod_ip: text_field(status, "podIP", ""),
        host_ip: text_field(status, "hostIP", ""),
        qos_class: text_field(status, "qosClass", ""),
        start_time: text_field(status, "startTime", ""),
        ready_containers,
        total_containers: containers.len(),
        conditions,
        containers,
    })
}

fn container_details(container: &serde_json::Value) -> ContainerDetails {
    let state = container.get("state").unwrap_or(&serde_json::Value::Null);
    let state_name = state
        .as_object()
        .and_then(|states| states.keys().next())
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());
    let reason = state
        .get(&state_name)
        .and_then(|value| value.get("reason"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();

    ContainerDetails {
        name: text_field(container, "name", "container"),
        image: text_field(container, "image", ""),
        ready: container.get("ready").and_then(|value| value.as_bool()).unwrap_or(false),
        restart_count: container.get("restartCount").and_then(|value| value.as_u64()).unwrap_or(0) as u32,
        state: state_name,
        reason,
    }
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

    let Some((kind, name)) = owner.split_once('/') else {
        return Err("Pod has no owning workload to restart.".to_string());
    };

    if kind == "ReplicaSet" {
        let deployment = name.rsplit_once('-').map(|(prefix, _)| prefix).unwrap_or(name);
        return Ok(vec![
            "rollout".to_string(),
            "restart".to_string(),
            format!("deployment/{deployment}"),
            "-n".to_string(),
            target.namespace.clone(),
        ]);
    }

    if matches!(kind, "Deployment" | "StatefulSet" | "DaemonSet") {
        return Ok(vec![
            "rollout".to_string(),
            "restart".to_string(),
            format!("{}/{}", kind.to_lowercase(), name),
            "-n".to_string(),
            target.namespace.clone(),
        ]);
    }

    Err(format!("Restart is not available for pods owned by {kind}."))
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
        format!("involvedObject.name={}", target.name),
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
        .map(|items| {
            items
                .iter()
                .map(|event| ResourceEvent {
                    type_: text_field(event, "type", "Normal"),
                    reason: text_field(event, "reason", "Event"),
                    message: text_field(event, "message", ""),
                    age: event
                        .get("lastTimestamp")
                        .or_else(|| event.get("eventTime"))
                        .or_else(|| event.pointer("/metadata/creationTimestamp"))
                        .and_then(|value| value.as_str())
                        .map(short_age)
                        .unwrap_or_else(|| "live".to_string()),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(events)
}

fn resource_yaml_args(target: &ActionTarget) -> Vec<String> {
    let mut args = vec![
        "get".to_string(),
        target.kind.clone(),
        target.name.clone(),
        "-o".to_string(),
        "yaml".to_string(),
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
    let output = tokio::process::Command::new(command)
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

fn helm_target_args(target: &ActionTarget, args: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut args = args.into_iter().collect::<Vec<_>>();
    if !target.cluster.is_empty() {
        args.push("--kube-context".to_string());
        args.push(target.cluster.clone());
    }
    args
}

fn pod_exec_command(target: &ActionTarget) -> String {
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
        "--".to_string(),
        "/bin/sh".to_string(),
    ]);

    format!(
        "kubectl {}",
        args.iter()
            .map(|arg| shell_quote(arg))
            .collect::<Vec<_>>()
            .join(" ")
    )
}

async fn open_terminal(command: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("Interactive exec is only wired to open Terminal on macOS for now. Run this command manually.".to_string());
    }

    let script = format!(
        "tell application \"Terminal\" to do script \"{}\"",
        applescript_string(command)
    );
    let output = tokio::process::Command::new("osascript")
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

fn short_age(timestamp: &str) -> String {
    timestamp.split('T').next().unwrap_or(timestamp).to_string()
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
            let restarts = pod
                .status
                .as_ref()
                .and_then(|status| status.container_statuses.as_ref())
                .map(|statuses| statuses.iter().map(|status| status.restart_count as u32).sum())
                .unwrap_or(0);
            let image = pod
                .status
                .as_ref()
                .and_then(|status| status.container_statuses.as_ref())
                .and_then(|statuses| statuses.first())
                .map(|status| status.image.clone())
                .unwrap_or_default();
            let phase = pod.status.as_ref().and_then(|status| status.phase.as_deref());
            let status = match phase {
                Some("Running") | Some("Succeeded") => HealthState::Healthy,
                Some("Failed") => HealthState::Critical,
                Some(_) => HealthState::Warning,
                None => HealthState::Syncing,
            };
            let owner = pod
                .metadata
                .owner_references
                .as_ref()
                .and_then(|owners| owners.first())
                .map(|owner| format!("{}/{}", owner.kind, owner.name))
                .unwrap_or_default();
            let labels = pod.metadata.labels.clone().unwrap_or_default();

            resource_summary("Pod", pod.name_any(), pod.namespace().unwrap_or_else(|| "default".to_string()), cluster, status, restarts, image)
                .with_labels(labels)
                .with_owner(owner)
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
            let unavailable = deployment
                .status
                .as_ref()
                .and_then(|status| status.unavailable_replicas)
                .unwrap_or(0);
            let image = deployment
                .spec
                .as_ref()
                .and_then(|spec| spec.template.spec.as_ref())
                .and_then(|spec| spec.containers.first())
                .map(|container| container.image.clone().unwrap_or_default())
                .unwrap_or_default();
            let status = if unavailable > 0 {
                HealthState::Warning
            } else {
                HealthState::Healthy
            };
            let labels = deployment.metadata.labels.clone().unwrap_or_default();
            let selector = deployment.spec.as_ref().and_then(|spec| spec.selector.match_labels.clone()).unwrap_or_default();

            resource_summary(
                "Deployment",
                deployment.name_any(),
                deployment.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                status,
                0,
                image,
            )
            .with_labels(labels)
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
            let status = job_status(&job);
            let image = job
                .spec
                .as_ref()
                .and_then(|spec| spec.template.spec.as_ref())
                .and_then(|spec| spec.containers.first())
                .map(|container| container.image.clone().unwrap_or_default())
                .unwrap_or_default();
            let labels = job.metadata.labels.clone().unwrap_or_default();

            resource_summary(
                "Job",
                job.name_any(),
                job.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                status,
                0,
                image,
            )
            .with_labels(labels)
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
            .with_labels(labels)
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
            .with_selector(selector)
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
            let event_type = event.type_.clone().unwrap_or_else(|| "Normal".to_string());
            let reason = event.reason.clone().unwrap_or_default();
            resource_summary(
                "Event",
                event.name_any(),
                event.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                if event_type == "Warning" { HealthState::Warning } else { HealthState::Healthy },
                0,
                event_type,
            )
            .with_owner(reason)
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
            resource_summary(
                "Namespace",
                namespace.name_any(),
                "cluster".to_string(),
                cluster,
                HealthState::Healthy,
                0,
                String::new(),
            )
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
        owner: namespace,
        image,
        labels: BTreeMap::new(),
        selector: BTreeMap::new(),
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

trait ResourceSummaryPatch {
    fn with_owner(self, owner: String) -> Self;
    fn with_age(self, age: String) -> Self;
    fn with_labels(self, labels: BTreeMap<String, String>) -> Self;
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

    fn with_labels(mut self, labels: BTreeMap<String, String>) -> Self {
        self.labels = labels;
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
