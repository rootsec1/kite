use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KubeContextSummary {
    pub name: String,
    pub cluster: String,
    pub user: String,
    pub current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshot {
    pub clusters: Vec<ClusterSummary>,
    pub namespace_heat: Vec<NamespaceHeat>,
    pub resources: Vec<ResourceSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSummary {
    pub id: String,
    pub name: String,
    pub region: String,
    pub provider: String,
    pub version: String,
    pub health: HealthState,
    pub latency_ms: u16,
    pub namespaces: usize,
    pub workloads: usize,
    pub warnings: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceHeat {
    pub namespace: String,
    pub cpu: u8,
    pub memory: u8,
    pub restarts: u32,
    pub risk: HealthState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSummary {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub cluster: String,
    pub status: HealthState,
    pub age: String,
    pub cpu: u8,
    pub memory: u8,
    pub restarts: u32,
    pub owner: String,
    pub image: String,
    pub node_name: String,
    pub diagnostic: String,
    pub labels: BTreeMap<String, String>,
    pub references: Vec<ResourceReference>,
    pub selector: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceReference {
    pub kind: String,
    pub namespace: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDetails {
    pub yaml: String,
    pub events: Vec<ResourceEvent>,
    pub logs: String,
    pub previous_logs: String,
    pub pod: Option<PodDetails>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodDetails {
    pub phase: String,
    pub reason: String,
    pub message: String,
    pub node_name: String,
    pub pod_ip: String,
    pub host_ip: String,
    pub qos_class: String,
    pub start_time: String,
    pub ready_containers: usize,
    pub total_containers: usize,
    pub conditions: Vec<PodCondition>,
    pub containers: Vec<ContainerDetails>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodCondition {
    #[serde(rename = "type")]
    pub type_: String,
    pub status: String,
    pub reason: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetails {
    pub name: String,
    pub role: String,
    pub image: String,
    pub ports: Vec<u16>,
    pub probes: Vec<ContainerProbe>,
    pub requests: BTreeMap<String, String>,
    pub limits: BTreeMap<String, String>,
    pub ready: bool,
    pub restart_count: u32,
    pub state: String,
    pub reason: String,
    pub message: String,
    pub exit_code: Option<u32>,
    pub started_at: String,
    pub finished_at: String,
    pub last_reason: String,
    pub last_exit_code: Option<u32>,
    pub last_started_at: String,
    pub last_finished_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerProbe {
    pub kind: String,
    pub check: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEvent {
    #[serde(rename = "type")]
    pub type_: String,
    pub reason: String,
    pub message: String,
    pub age: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum HealthState {
    Healthy,
    Warning,
    Critical,
    Syncing,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionTarget {
    pub kind: String,
    pub name: String,
    pub namespace: String,
    pub cluster: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPreview {
    pub action: String,
    pub risk: ActionRisk,
    pub requires_confirmation: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodActionResult {
    pub action: String,
    pub status: PodActionStatus,
    pub message: String,
    pub output: String,
    pub command: String,
    pub requires_confirmation: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PodActionStatus {
    Ready,
    Blocked,
    Executed,
    Failed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionRisk {
    Low,
    Medium,
    High,
}
