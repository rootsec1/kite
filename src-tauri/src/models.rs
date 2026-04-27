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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDetails {
    pub yaml: String,
    pub events: Vec<ResourceEvent>,
    pub logs: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEvent {
    #[serde(rename = "type")]
    pub type_: String,
    pub reason: String,
    pub message: String,
    pub age: String,
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
#[serde(rename_all = "lowercase")]
pub enum ActionRisk {
    Low,
    Medium,
    High,
}
