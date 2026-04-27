use std::{env, fs, path::PathBuf};

use k8s_openapi::api::{
    apps::v1::Deployment,
    core::v1::{Namespace, Node, Pod, Service},
};
use kube::{
    api::ListParams,
    Api, Client, ResourceExt,
};
use serde::Deserialize;

use crate::models::{
    ActionPreview, ActionRisk, ActionTarget, ClusterProbe, ClusterSummary, HealthState, KubeContextSummary,
    LiveSnapshot, NamespaceHeat, ResourceDetails, ResourceEvent, ResourceSummary,
};

#[derive(Debug, Deserialize)]
struct RawKubeconfig {
    #[serde(default, rename = "current-context")]
    current_context: String,
    #[serde(default)]
    contexts: Vec<NamedContext>,
}

#[derive(Debug, Deserialize)]
struct NamedContext {
    name: String,
    context: RawContext,
}

#[derive(Debug, Deserialize)]
struct RawContext {
    #[serde(default)]
    cluster: String,
    #[serde(default)]
    user: String,
}

#[tauri::command]
pub fn list_kube_contexts() -> Result<Vec<KubeContextSummary>, String> {
    let path = kubeconfig_path()?;
    let raw = fs::read_to_string(&path).map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
    let config: RawKubeconfig = serde_yaml::from_str(&raw).map_err(|error| format!("Invalid kubeconfig: {error}"))?;

    Ok(config
        .contexts
        .into_iter()
        .map(|entry| KubeContextSummary {
            current: entry.name == config.current_context,
            name: entry.name,
            cluster: entry.context.cluster,
            user: entry.context.user,
        })
        .collect())
}

#[tauri::command]
pub async fn probe_default_cluster() -> Result<ClusterProbe, String> {
    let client = Client::try_default()
        .await
        .map_err(|error| format!("Unable to create Kubernetes client: {error}"))?;
    let namespaces: Api<Namespace> = Api::all(client);
    let params = ListParams::default().limit(24);
    let list = namespaces
        .list(&params)
        .await
        .map_err(|error| format!("Unable to list namespaces: {error}"))?;

    let names = list
        .items
        .into_iter()
        .filter_map(|namespace| namespace.metadata.name)
        .collect::<Vec<_>>();

    Ok(ClusterProbe {
        reachable: true,
        message: "Default Kubernetes context is reachable".to_string(),
        namespaces: names,
    })
}

#[tauri::command]
pub async fn live_snapshot() -> Result<LiveSnapshot, String> {
    let started = std::time::Instant::now();
    let client = Client::try_default()
        .await
        .map_err(|error| format!("Unable to create Kubernetes client: {error}"))?;
    let contexts = list_kube_contexts().unwrap_or_default();
    let context = contexts
        .iter()
        .find(|context| context.current)
        .map(|context| context.name.clone())
        .unwrap_or_else(|| "current-context".to_string());
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
    resources.extend(list_services(client.clone(), &context).await?);
    resources.extend(list_nodes(client.clone(), &context).await?);
    resources.extend(list_namespaces(client.clone(), &context).await?);

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
    let yaml = kubectl(resource_yaml_args(&target))
        .await
        .unwrap_or_else(|error| error);
    let events = resource_events(&target).await.unwrap_or_default();
    let logs = if target.kind == "Pod" {
        kubectl(vec![
            "logs".to_string(),
            target.name.clone(),
            "-n".to_string(),
            target.namespace.clone(),
            "--tail=240".to_string(),
            "--timestamps".to_string(),
        ])
        .await
        .unwrap_or_else(|error| error)
    } else {
        String::new()
    };

    ResourceDetails { yaml, events, logs }
}

fn classify_action(action: &str) -> ActionRisk {
    match action {
        "delete" | "apply" | "edit" | "scale" | "set-image" | "rollback" => ActionRisk::High,
        "restart" | "debug" | "exec" | "node-shell" | "port-forward" | "trigger-cronjob" => ActionRisk::Medium,
        _ => ActionRisk::Low,
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

    let output = kubectl(args).await?;
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

    args
}

async fn kubectl(args: Vec<String>) -> Result<String, String> {
    let output = tokio::process::Command::new("kubectl")
        .args(args)
        .output()
        .await
        .map_err(|error| format!("Unable to run kubectl: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
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

fn kubeconfig_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("KUBECONFIG") {
        let first = env::split_paths(&path)
            .next()
            .ok_or_else(|| "KUBECONFIG is set but empty".to_string())?;
        return Ok(first);
    }

    let home = env::var("HOME").map_err(|_| "HOME is not set and KUBECONFIG was not provided".to_string())?;
    Ok(PathBuf::from(home).join(".kube").join("config"))
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

            resource_summary("Pod", pod.name_any(), pod.namespace().unwrap_or_else(|| "default".to_string()), cluster, status, restarts, image)
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

            resource_summary(
                "Deployment",
                deployment.name_any(),
                deployment.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                status,
                0,
                image,
            )
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
            resource_summary(
                "Service",
                service.name_any(),
                service.namespace().unwrap_or_else(|| "default".to_string()),
                cluster,
                HealthState::Healthy,
                0,
                service.spec.and_then(|spec| spec.type_).unwrap_or_default(),
            )
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
