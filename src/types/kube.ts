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

export type KubeContextSummary = {
  name: string;
  cluster: string;
  user: string;
  current: boolean;
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
  nodeName: string;
  diagnostic: string;
  labels: Record<string, string>;
  references: ResourceReference[];
  selector: Record<string, string>;
};

export type ResourceReference = {
  kind: string;
  namespace: string;
  name: string;
};

export type ResourceEvent = {
  type: string;
  reason: string;
  message: string;
  age: string;
  count: number;
};

export type ResourceDetails = {
  yaml: string;
  events: ResourceEvent[];
  logs: string;
  previousLogs: string;
  pod?: PodDetails;
};

export type PodDetails = {
  phase: string;
  reason: string;
  message: string;
  nodeName: string;
  podIp: string;
  hostIp: string;
  qosClass: string;
  startTime: string;
  readyContainers: number;
  totalContainers: number;
  conditions: PodCondition[];
  containers: ContainerDetails[];
};

export type PodCondition = {
  type: string;
  status: string;
  reason: string;
  message: string;
};

export type ContainerDetails = {
  name: string;
  role: "app" | "init" | "ephemeral";
  image: string;
  ports: number[];
  requests: Record<string, string>;
  limits: Record<string, string>;
  ready: boolean;
  restartCount: number;
  state: string;
  reason: string;
  message: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  lastReason: string;
  lastExitCode: number | null;
  lastStartedAt: string;
  lastFinishedAt: string;
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

export type PodActionResult = {
  action: string;
  status: "ready" | "blocked" | "executed" | "failed";
  message: string;
  output: string;
  command: string;
  requiresConfirmation: boolean;
};
