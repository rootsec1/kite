import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

type KubeItem = {
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
  };
  spec?: {
    providerID?: string;
    containers?: Array<{ image?: string }>;
    type?: string;
    claimRef?: { namespace?: string; name?: string };
    template?: { spec?: { containers?: Array<{ image?: string }> } };
  };
  status?: {
    phase?: string;
    replicas?: number;
    availableReplicas?: number;
    unavailableReplicas?: number;
    conditions?: Array<{ type?: string; status?: string }>;
    containerStatuses?: Array<{ restartCount?: number; image?: string }>;
  };
};

type KubeList = {
  items?: KubeItem[];
};

const resourceQueries = [
  { name: "pods", namespaced: true },
  { name: "deployments.apps", namespaced: true },
  { name: "statefulsets.apps", namespaced: true },
  { name: "daemonsets.apps", namespaced: true },
  { name: "jobs.batch", namespaced: true },
  { name: "cronjobs.batch", namespaced: true },
  { name: "services", namespaced: true },
  { name: "ingresses.networking.k8s.io", namespaced: true },
  { name: "gateways.gateway.networking.k8s.io", namespaced: true },
  { name: "httproutes.gateway.networking.k8s.io", namespaced: true },
  { name: "configmaps", namespaced: true },
  { name: "secrets", namespaced: true },
  { name: "persistentvolumeclaims", namespaced: true },
  { name: "roles.rbac.authorization.k8s.io", namespaced: true },
  { name: "rolebindings.rbac.authorization.k8s.io", namespaced: true },
  { name: "nodes", namespaced: false },
  { name: "namespaces", namespaced: false },
  { name: "persistentvolumes", namespaced: false },
  { name: "storageclasses.storage.k8s.io", namespaced: false },
  { name: "clusterroles.rbac.authorization.k8s.io", namespaced: false },
  { name: "clusterrolebindings.rbac.authorization.k8s.io", namespaced: false },
];

export async function readKubeSnapshot() {
  const context = await kubectlText(["config", "current-context"]).catch(() => "no-context");
  const version = await kubectlJson(["version", "--output=json"]).catch(() => null);
  const lists = await Promise.all(resourceQueries.map((query) => readResourceList(query)));
  const items = lists.flatMap((list) => list.items ?? []);
  const resources = items.map((item, index) => toResource(item, context.trim(), index));
  const namespaces = items
    .filter((item) => item.kind === "Namespace")
    .map((item) => item.metadata?.name)
    .filter(Boolean) as string[];

  const warningCount = resources.filter((item) => item.status !== "healthy").length;

  return {
    clusters: [
      {
        id: context.trim(),
        name: context.trim(),
        region: "local",
        provider: detectProvider(items),
        version: version?.serverVersion?.gitVersion ?? "unknown",
        health: warningCount > 0 ? "warning" : "healthy",
        latencyMs: 0,
        namespaces: namespaces.length,
        workloads: resources.length,
        warnings: warningCount,
      },
    ],
    namespaceHeat: namespaces.slice(0, 10).map((namespace) => toNamespaceHeat(namespace, resources)),
    resources,
  };
}

async function readResourceList(query: { name: string; namespaced: boolean }) {
  const args = ["get", query.name, "-o", "json"];
  if (query.namespaced) {
    args.splice(2, 0, "-A");
  }

  return kubectlJson<KubeList>(args).catch(() => ({ items: [] }));
}

async function kubectlJson<T = any>(args: string[]) {
  const text = await kubectlText(args);
  return JSON.parse(text) as T;
}

async function kubectlText(args: string[]) {
  const { stdout } = await exec("kubectl", args, { timeout: 12_000, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

function toResource(item: KubeItem, cluster: string, index: number) {
  const kind = item.kind ?? "Resource";
  const name = item.metadata?.name ?? `${kind.toLowerCase()}-${index}`;
  const namespace = item.metadata?.namespace ?? "cluster";
  const restarts = item.status?.containerStatuses?.reduce((sum, status) => sum + (status.restartCount ?? 0), 0) ?? 0;
  const status = resourceStatus(item);
  const pressure = Math.min(100, restarts * 9 + (status === "critical" ? 70 : status === "warning" ? 44 : 18));

  return {
    id: `${kind}:${namespace}:${name}`,
    kind,
    name,
    namespace,
    cluster,
    status,
    age: age(item.metadata?.creationTimestamp),
    cpu: pressure,
    memory: Math.min(100, pressure + 8),
    restarts,
    owner: namespace,
    image:
      item.status?.containerStatuses?.[0]?.image ??
      item.spec?.containers?.[0]?.image ??
      item.spec?.template?.spec?.containers?.[0]?.image ??
      "",
  };
}

function resourceStatus(item: KubeItem) {
  if (item.kind === "PersistentVolumeClaim" || item.kind === "PersistentVolume") {
    return item.status?.phase === "Bound" || item.status?.phase === "Available" ? "healthy" : "warning";
  }

  if (item.kind === "Job") {
    const failed = item.status?.conditions?.find((condition) => condition.type === "Failed");
    if (failed?.status === "True") return "critical";
    return "healthy";
  }

  if (item.kind === "Node") {
    const ready = item.status?.conditions?.find((condition) => condition.type === "Ready");
    return ready?.status === "True" ? "healthy" : "critical";
  }

  if (item.kind === "Pod") {
    if (item.status?.phase === "Running" || item.status?.phase === "Succeeded") return "healthy";
    if (item.status?.phase === "Failed") return "critical";
    return "warning";
  }

  if (item.kind === "Deployment") {
    if ((item.status?.unavailableReplicas ?? 0) > 0) return "warning";
    return "healthy";
  }

  return "healthy";
}

function toNamespaceHeat(namespace: string, resources: Array<ReturnType<typeof toResource>>) {
  const scoped = resources.filter((resource) => resource.namespace === namespace);
  const restarts = scoped.reduce((sum, resource) => sum + resource.restarts, 0);
  const maxPressure = scoped.reduce((max, resource) => Math.max(max, resource.cpu, resource.memory), 0);

  return {
    namespace,
    cpu: maxPressure,
    memory: Math.min(100, maxPressure + restarts),
    restarts,
    risk: restarts > 5 ? "critical" : maxPressure > 45 ? "warning" : "healthy",
  };
}

function detectProvider(items: KubeItem[]) {
  const providerId = items.find((item) => item.kind === "Node")?.spec?.providerID ?? "";
  if (providerId.includes("k3d")) return "k3d";
  if (providerId.includes("aws")) return "EKS";
  if (providerId.includes("gce")) return "GKE";
  if (providerId.includes("azure")) return "AKS";
  return "kube";
}

function age(timestamp?: string) {
  if (!timestamp) return "live";
  const created = new Date(timestamp).getTime();
  const days = Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
  if (days > 0) return `${days}d`;
  return "today";
}
