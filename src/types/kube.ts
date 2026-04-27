export type HealthState = "healthy" | "warning" | "critical" | "syncing";

export type Cluster = {
  id: string;
  name: string;
  region: string;
  provider: string;
  version: string;
  health: HealthState;
  latencyMs: number;
  namespaces: number;
  workloads: number;
  warnings: number;
};

export type NamespaceHeat = {
  namespace: string;
  cpu: number;
  memory: number;
  restarts: number;
  risk: HealthState;
};

export type ResourceRow = {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  cluster: string;
  status: HealthState;
  age: string;
  cpu: number;
  memory: number;
  restarts: number;
  owner: string;
  image: string;
};

export type LiveSnapshot = {
  clusters: Cluster[];
  namespaceHeat: NamespaceHeat[];
  resources: ResourceRow[];
};

export type ActionPreview = {
  action: string;
  risk: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  message: string;
};
