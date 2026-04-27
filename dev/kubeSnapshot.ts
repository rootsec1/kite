import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

type KubeItem = {
  kind?: string;
  type?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string }>;
  };
  spec?: {
    providerID?: string;
    containers?: Array<{ image?: string }>;
    nodeName?: string;
    selector?: Record<string, string> | { matchLabels?: Record<string, string> };
    type?: string;
    claimRef?: { namespace?: string; name?: string };
    template?: { spec?: { containers?: Array<{ image?: string }> } };
  };
  status?: {
    phase?: string;
    podIP?: string;
    hostIP?: string;
    qosClass?: string;
    startTime?: string;
    replicas?: number;
    availableReplicas?: number;
    unavailableReplicas?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string }>;
    containerStatuses?: Array<{
      name?: string;
      image?: string;
      ready?: boolean;
      restartCount?: number;
      state?: Record<string, { reason?: string }>;
    }>;
  };
};

type KubeList = {
  items?: KubeItem[];
};

type HelmRelease = {
  name?: string;
  namespace?: string;
  revision?: string;
  updated?: string;
  status?: string;
  chart?: string;
  app_version?: string;
};

type KubeEvent = {
  type?: string;
  reason?: string;
  message?: string;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: { creationTimestamp?: string };
};

const resourceQueries = [
  { name: "pods", namespaced: true },
  { name: "deployments.apps", namespaced: true },
  { name: "statefulsets.apps", namespaced: true },
  { name: "daemonsets.apps", namespaced: true },
  { name: "jobs.batch", namespaced: true },
  { name: "cronjobs.batch", namespaced: true },
  { name: "services", namespaced: true },
  { name: "events", namespaced: true },
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
  { name: "customresourcedefinitions.apiextensions.k8s.io", namespaced: false },
];

export async function readKubeSnapshot() {
  const context = await kubectlText(["config", "current-context"]).catch(() => "no-context");
  const version = await kubectlJson(["version", "--output=json"]).catch(() => null);
  const lists = await Promise.all(resourceQueries.map((query) => readResourceList(query)));
  const items = lists.flatMap((list) => list.items ?? []);
  const helmReleases = await readHelmReleases(context.trim());
  const resources = [
    ...items.map((item, index) => toResource(item, context.trim(), index)),
    ...helmReleases,
  ];
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

export async function readResourceDetails(target: { kind: string; name: string; namespace: string }) {
  if (target.kind === "HelmRelease") {
    return readHelmDetails(target);
  }

  const yaml = await readResourceYaml(target).catch((error) => errorMessage(error));
  const events = await readResourceEvents(target).catch(() => []);
  const pod = target.kind === "Pod" ? await readPodDetails(target).catch(() => undefined) : undefined;
  const logs = target.kind === "Pod" ? await readPodLogs(target).catch((error) => errorMessage(error)) : "";

  return { yaml, events, logs, pod };
}

export async function runPodAction(input: {
  action: string;
  confirmed: boolean;
  target: { kind: string; name: string; namespace: string; cluster: string };
}) {
  const action = input.action.toLowerCase();
  const { target } = input;

  if (target.kind !== "Pod") {
    return podActionResult(action, "blocked", "Pod actions only run against pods.");
  }

  if (action === "logs") {
    const command = `kubectl logs ${target.name} -n ${target.namespace} --all-containers=true --prefix=true --tail=240 --timestamps`;
    return readPodLogs(target)
      .then((output) => podActionResult(action, "executed", "Read latest pod logs.", output, command))
      .catch((error) => podActionResult(action, "failed", errorMessage(error), "", command));
  }

  if (action === "exec") {
    const command = podExecCommand(target);
    return openTerminal(command)
      .then(() => podActionResult(action, "executed", "Opened Terminal with an interactive pod shell.", "", command))
      .catch((error) => podActionResult(action, "ready", `${errorMessage(error)} Run this command manually.`, "", command));
  }

  if (action === "restart" || action === "delete" || action === "kill") {
    if (!isLocalContext(target.cluster)) {
      return podActionResult(action, "blocked", `${target.cluster} is not recognized as a local context.`);
    }

    const args = action === "restart"
      ? await restartArgs(target).catch((error) => ({ error: errorMessage(error) }))
      : ["delete", "pod", target.name, "-n", target.namespace];

    if ("error" in args) {
      return podActionResult(action, "blocked", args.error);
    }

    const command = `kubectl ${args.join(" ")}`;
    if (!input.confirmed) {
      return podActionResult(action, "blocked", `Confirm to run against ${target.namespace}/${target.name}.`, "", command, true);
    }

    return kubectlText(args)
      .then((output) => podActionResult(action, "executed", "Action completed.", output, command))
      .catch((error) => podActionResult(action, "failed", errorMessage(error), "", command));
  }

  return podActionResult(action, "blocked", "Unsupported pod action.");
}

async function readHelmReleases(cluster: string) {
  const releases = await exec("helm", ["list", "-A", "-o", "json"], { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
    .then(({ stdout }) => JSON.parse(stdout) as HelmRelease[])
    .catch(() => []);

  return releases.map((release, index) => ({
    id: `HelmRelease:${release.namespace ?? "default"}:${release.name ?? index}`,
    kind: "HelmRelease",
    name: release.name ?? `release-${index}`,
    namespace: release.namespace ?? "default",
    cluster,
    status: release.status === "deployed" ? "healthy" : "warning",
    age: age(release.updated),
    cpu: release.status === "deployed" ? 12 : 44,
    memory: release.status === "deployed" ? 20 : 52,
    restarts: 0,
    owner: release.chart ?? "",
    image: release.app_version ?? release.revision ?? "",
    labels: {},
    selector: {},
  }));
}

async function readHelmDetails(target: { name: string; namespace: string }) {
  const [manifest, status, values] = await Promise.all([
    exec("helm", ["get", "manifest", target.name, "-n", target.namespace], { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
      .then(({ stdout }) => stdout)
      .catch((error) => errorMessage(error)),
    exec("helm", ["status", target.name, "-n", target.namespace], { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
      .then(({ stdout }) => stdout)
      .catch(() => ""),
    exec("helm", ["get", "values", target.name, "-n", target.namespace, "-o", "yaml"], { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
      .then(({ stdout }) => stdout)
      .catch(() => ""),
  ]);

  return {
    yaml: [manifest, values ? `\n---\n# values\n${values}` : ""].join(""),
    events: status ? [{ type: "Normal", reason: "HelmStatus", message: status, age: "live" }] : [],
    logs: "",
  };
}

async function readResourceYaml(target: { kind: string; name: string; namespace: string }) {
  const args = ["get", target.kind, target.name, "-o", "yaml"];
  if (target.namespace && target.namespace !== "cluster") {
    args.splice(3, 0, "-n", target.namespace);
  }
  return kubectlText(args);
}

async function readResourceEvents(target: { kind: string; name: string; namespace: string }) {
  const args = [
    "get",
    "events",
    "--field-selector",
    `involvedObject.name=${target.name}`,
    "-o",
    "json",
  ];
  if (target.namespace && target.namespace !== "cluster") {
    args.splice(2, 0, "-n", target.namespace);
  } else {
    args.splice(2, 0, "-A");
  }

  const list = await kubectlJson<{ items?: KubeEvent[] }>(args);
  return (list.items ?? []).map((event) => ({
    type: event.type ?? "Normal",
    reason: event.reason ?? "Event",
    message: event.message ?? "",
    age: age(event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp),
  }));
}

async function readPodLogs(target: { name: string; namespace: string }) {
  return kubectlText([
    "logs",
    target.name,
    "-n",
    target.namespace,
    "--all-containers=true",
    "--prefix=true",
    "--tail=240",
    "--timestamps",
  ]);
}

async function readPodDetails(target: { name: string; namespace: string }) {
  const pod = await kubectlJson<KubeItem>(["get", "pod", target.name, "-n", target.namespace, "-o", "json"]);
  const containers = pod.status?.containerStatuses ?? [];

  return {
    phase: pod.status?.phase ?? "Unknown",
    nodeName: pod.spec?.nodeName ?? "",
    podIp: pod.status?.podIP ?? "",
    hostIp: pod.status?.hostIP ?? "",
    qosClass: pod.status?.qosClass ?? "",
    startTime: pod.status?.startTime ?? "",
    readyContainers: containers.filter((container) => container.ready).length,
    totalContainers: containers.length,
    conditions: (pod.status?.conditions ?? []).map((condition) => ({
      type: condition.type ?? "Condition",
      status: condition.status ?? "Unknown",
      reason: condition.reason ?? "",
    })),
    containers: containers.map((container) => {
      const stateName = Object.keys(container.state ?? {})[0] ?? "unknown";
      return {
        name: container.name ?? "container",
        image: container.image ?? "",
        ready: Boolean(container.ready),
        restartCount: container.restartCount ?? 0,
        state: stateName,
        reason: container.state?.[stateName]?.reason ?? "",
      };
    }),
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
  const owner = item.metadata?.ownerReferences?.[0];

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
    owner: owner?.kind && owner?.name ? `${owner.kind}/${owner.name}` : namespace,
    image:
      item.status?.containerStatuses?.[0]?.image ??
      item.spec?.containers?.[0]?.image ??
      item.spec?.template?.spec?.containers?.[0]?.image ??
      "",
    labels: item.metadata?.labels ?? {},
    selector: selectorLabels(item.spec?.selector),
  };
}

function selectorLabels(selector: KubeItem["spec"]["selector"]) {
  if (!selector || typeof selector !== "object") return {};
  if ("matchLabels" in selector) return selector.matchLabels ?? {};
  return selector as Record<string, string>;
}

async function restartArgs(target: { name: string; namespace: string }) {
  const owner = await kubectlText([
    "get",
    "pod",
    target.name,
    "-n",
    target.namespace,
    "-o",
    "jsonpath={.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}",
  ]);
  const [kind, name] = owner.split("/");
  if (!kind || !name) {
    throw new Error("Pod has no owning workload to restart.");
  }
  if (kind === "ReplicaSet") {
    const deployment = name.split("-").slice(0, -1).join("-");
    return ["rollout", "restart", `deployment/${deployment || name}`, "-n", target.namespace];
  }
  if (["Deployment", "StatefulSet", "DaemonSet"].includes(kind)) {
    return ["rollout", "restart", `${kind.toLowerCase()}/${name}`, "-n", target.namespace];
  }
  throw new Error(`Restart is not available for pods owned by ${kind}.`);
}

function isLocalContext(context: string) {
  const normalized = context.toLowerCase();
  return (
    normalized.startsWith("k3d-") ||
    normalized.startsWith("kind-") ||
    normalized === "minikube" ||
    normalized === "docker-desktop" ||
    normalized.includes("localhost")
  );
}

function podActionResult(
  action: string,
  status: "ready" | "blocked" | "executed" | "failed",
  message: string,
  output = "",
  command = "",
  requiresConfirmation = false,
) {
  return { action, status, message, output, command, requiresConfirmation };
}

function podExecCommand(target: { name: string; namespace: string; cluster: string }) {
  return [
    "kubectl",
    "--context",
    target.cluster,
    "exec",
    "-n",
    target.namespace,
    "-it",
    target.name,
    "--",
    "/bin/sh",
  ].map(shellQuote).join(" ");
}

async function openTerminal(command: string) {
  if (process.platform !== "darwin") {
    throw new Error("Interactive exec is only wired to open Terminal on macOS for now.");
  }

  await exec("osascript", [
    "-e",
    "tell application \"Terminal\" to activate",
    "-e",
    `tell application "Terminal" to do script "${applescriptString(command)}"`,
  ], { timeout: 5_000 });
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9._/:=@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function applescriptString(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function resourceStatus(item: KubeItem) {
  if (item.kind === "Event") {
    return item.type === "Warning" ? "warning" : "healthy";
  }

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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to read resource details";
}
