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
  roleRef?: {
    kind?: string;
    name?: string;
  };
  spec?: {
    providerID?: string;
    containers?: Array<{ image?: string }>;
    nodeName?: string;
    selector?: Record<string, string> | { matchLabels?: Record<string, string> };
    type?: string;
    volumes?: KubeVolume[];
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
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
    containerStatuses?: KubeContainerStatus[];
    ephemeralContainerStatuses?: KubeContainerStatus[];
    initContainerStatuses?: KubeContainerStatus[];
    reason?: string;
    message?: string;
  };
};

type KubeContainerStatus = {
  name?: string;
  image?: string;
  ready?: boolean;
  restartCount?: number;
  state?: Record<string, ContainerStateDetails>;
  lastState?: Record<string, ContainerStateDetails>;
};

type ContainerStateDetails = {
  reason?: string;
  message?: string;
  exitCode?: number;
};

type KubeVolume = {
  configMap?: { name?: string };
  persistentVolumeClaim?: { claimName?: string };
  secret?: { secretName?: string };
};

type KubeList = {
  items?: KubeItem[];
};

type KubeContext = {
  name?: string;
  context?: {
    cluster?: string;
    user?: string;
  };
};

type KubeConfigView = {
  "current-context"?: string;
  contexts?: KubeContext[];
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
const criticalPodContainerReasons = new Set([
  "CrashLoopBackOff",
  "CreateContainerConfigError",
  "CreateContainerError",
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
  "RunContainerError",
]);

export async function readKubeContexts() {
  const view = await kubectlJson<KubeConfigView>(["config", "view", "--raw", "-o", "json"]);
  const current = view["current-context"] ?? "";
  return (view.contexts ?? []).map((entry) => ({
    name: entry.name ?? "",
    cluster: entry.context?.cluster ?? "",
    user: entry.context?.user ?? "",
    current: entry.name === current,
  })).filter((entry) => entry.name);
}

export async function readKubeSnapshot(selectedContext?: string) {
  const contexts = await readKubeContexts().catch(() => []);
  const context = selectedContext || contexts.find((entry) => entry.current)?.name || contexts[0]?.name || "no-context";
  const version = await kubectlJson(["version", "--output=json"], context).catch(() => null);
  const lists = await Promise.all(resourceQueries.map((query) => readResourceList(query, context)));
  const items = lists.flatMap((list) => list.items ?? []);
  const helmReleases = await readHelmReleases(context);
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

export async function readResourceDetails(target: { kind: string; name: string; namespace: string; cluster: string }) {
  if (target.kind === "HelmRelease") {
    return readHelmDetails(target);
  }

  const yaml = await readResourceYaml(target).catch((error) => errorMessage(error));
  const events = await readResourceEvents(target).catch(() => []);
  const pod = target.kind === "Pod" ? await readPodDetails(target).catch(() => undefined) : undefined;
  const logs = target.kind === "Pod" ? await readPodLogs(target).catch((error) => errorMessage(error)) : "";
  const previousLogs = target.kind === "Pod" ? await readPodLogs(target, true).catch(() => "") : "";

  return { yaml, events, logs, previousLogs, pod };
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
    const command = displayKubectlCommand([
      "logs",
      target.name,
      "-n",
      target.namespace,
      "--all-containers=true",
      "--prefix=true",
      "--tail=240",
      "--timestamps",
    ], target.cluster);
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

    const command = displayKubectlCommand(args, target.cluster);
    if (!input.confirmed) {
      return podActionResult(action, "blocked", `Confirm to run against ${target.namespace}/${target.name}.`, "", command, true);
    }

    return kubectlText(args, target.cluster)
      .then((output) => podActionResult(action, "executed", "Action completed.", output, command))
      .catch((error) => podActionResult(action, "failed", errorMessage(error), "", command));
  }

  return podActionResult(action, "blocked", "Unsupported pod action.");
}

async function readHelmReleases(cluster: string) {
  const releases = await exec("helm", helmArgs(["list", "-A", "-o", "json"], cluster), { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
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
    diagnostic: "",
    labels: {},
    references: [],
    selector: {},
  }));
}

async function readHelmDetails(target: { name: string; namespace: string; cluster: string }) {
  const [manifest, status, values] = await Promise.all([
    exec("helm", helmArgs(["get", "manifest", target.name, "-n", target.namespace], target.cluster), { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
      .then(({ stdout }) => stdout)
      .catch((error) => errorMessage(error)),
    exec("helm", helmArgs(["status", target.name, "-n", target.namespace], target.cluster), { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
      .then(({ stdout }) => stdout)
      .catch(() => ""),
    exec("helm", helmArgs(["get", "values", target.name, "-n", target.namespace, "-o", "yaml"], target.cluster), { timeout: 12_000, maxBuffer: 10 * 1024 * 1024 })
      .then(({ stdout }) => stdout)
      .catch(() => ""),
  ]);

  return {
    yaml: [manifest, values ? `\n---\n# values\n${values}` : ""].join(""),
    events: status ? [{ type: "Normal", reason: "HelmStatus", message: status, age: "live" }] : [],
    logs: "",
    previousLogs: "",
  };
}

async function readResourceYaml(target: { kind: string; name: string; namespace: string; cluster: string }) {
  const args = ["get", target.kind, target.name, "-o", "yaml"];
  if (target.namespace && target.namespace !== "cluster") {
    args.splice(3, 0, "-n", target.namespace);
  }
  return kubectlText(args, target.cluster);
}

async function readResourceEvents(target: { kind: string; name: string; namespace: string; cluster: string }) {
  const args = [
    "get",
    "events",
    "--field-selector",
    eventFieldSelector(target),
    "-o",
    "json",
  ];
  if (target.namespace && target.namespace !== "cluster") {
    args.splice(2, 0, "-n", target.namespace);
  } else {
    args.splice(2, 0, "-A");
  }

  const list = await kubectlJson<{ items?: KubeEvent[] }>(args, target.cluster);
  return (list.items ?? []).map((event) => ({
    type: event.type ?? "Normal",
    reason: event.reason ?? "Event",
    message: event.message ?? "",
    age: age(event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp),
  }));
}

function eventFieldSelector(target: { kind: string; name: string }) {
  return `involvedObject.name=${target.name},involvedObject.kind=${target.kind}`;
}

async function readPodLogs(target: { name: string; namespace: string; cluster: string }, previous = false) {
  const args = [
    "logs",
    target.name,
    "-n",
    target.namespace,
    "--all-containers=true",
    "--prefix=true",
    "--tail=240",
    "--timestamps",
  ];
  if (previous) {
    args.push("--previous=true");
  }
  return kubectlText(args, target.cluster);
}

async function readPodDetails(target: { name: string; namespace: string; cluster: string }) {
  const pod = await kubectlJson<KubeItem>(["get", "pod", target.name, "-n", target.namespace, "-o", "json"], target.cluster);
  const appContainers = pod.status?.containerStatuses ?? [];
  const containers = [
    ...containerDetails(pod.status?.initContainerStatuses, "init"),
    ...containerDetails(appContainers, "app"),
    ...containerDetails(pod.status?.ephemeralContainerStatuses, "ephemeral"),
  ];

  return {
    phase: pod.status?.phase ?? "Unknown",
    reason: pod.status?.reason ?? "",
    message: pod.status?.message ?? "",
    nodeName: pod.spec?.nodeName ?? "",
    podIp: pod.status?.podIP ?? "",
    hostIp: pod.status?.hostIP ?? "",
    qosClass: pod.status?.qosClass ?? "",
    startTime: pod.status?.startTime ?? "",
    readyContainers: appContainers.filter((container) => container.ready).length,
    totalContainers: appContainers.length,
    conditions: (pod.status?.conditions ?? []).map((condition) => ({
      type: condition.type ?? "Condition",
      status: condition.status ?? "Unknown",
      reason: condition.reason ?? "",
      message: condition.message ?? "",
    })),
    containers,
  };
}

function containerDetails(containers: KubeContainerStatus[] | undefined, role: "app" | "init" | "ephemeral") {
  return (containers ?? []).map((container) => {
    const stateName = Object.keys(container.state ?? {})[0] ?? "unknown";
    const state = container.state?.[stateName] ?? {};
    const lastTerminated = container.lastState?.terminated ?? {};
    return {
      name: container.name ?? "container",
      role,
      image: container.image ?? "",
      ready: Boolean(container.ready),
      restartCount: container.restartCount ?? 0,
      state: stateName,
      reason: state.reason ?? "",
      message: state.message ?? "",
      exitCode: state.exitCode ?? null,
      lastReason: lastTerminated.reason ?? "",
      lastExitCode: lastTerminated.exitCode ?? null,
    };
  });
}

async function readResourceList(query: { name: string; namespaced: boolean }, context: string) {
  const args = ["get", query.name, "-o", "json"];
  if (query.namespaced) {
    args.splice(2, 0, "-A");
  }

  return kubectlJson<KubeList>(args, context).catch(() => ({ items: [] }));
}

async function kubectlJson<T = any>(args: string[], context = "") {
  const text = await kubectlText(args, context);
  return JSON.parse(text) as T;
}

async function kubectlText(args: string[], context = "") {
  const { stdout } = await exec("kubectl", kubectlArgs(args, context), { timeout: 12_000, maxBuffer: 20 * 1024 * 1024 });
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
    owner: ownerForResource(item, namespace),
    image:
      item.status?.containerStatuses?.[0]?.image ??
      item.spec?.containers?.[0]?.image ??
      item.spec?.template?.spec?.containers?.[0]?.image ??
      "",
    diagnostic: resourceDiagnostic(item),
    labels: item.metadata?.labels ?? {},
    references: volumeReferences(item, namespace),
    selector: selectorLabels(item.spec?.selector),
  };
}

function volumeReferences(item: KubeItem, namespace: string) {
  return (item.spec?.volumes ?? []).flatMap((volume) => {
    const references = [];
    if (volume.configMap?.name) {
      references.push({ kind: "ConfigMap", namespace, name: volume.configMap.name });
    }
    if (volume.secret?.secretName) {
      references.push({ kind: "Secret", namespace, name: volume.secret.secretName });
    }
    if (volume.persistentVolumeClaim?.claimName) {
      references.push({ kind: "PersistentVolumeClaim", namespace, name: volume.persistentVolumeClaim.claimName });
    }
    return references;
  });
}

function ownerForResource(item: KubeItem, fallback: string) {
  if ((item.kind === "RoleBinding" || item.kind === "ClusterRoleBinding") && item.roleRef?.kind && item.roleRef.name) {
    return `${item.roleRef.kind}/${item.roleRef.name}`;
  }

  const owner = item.metadata?.ownerReferences?.[0];
  return owner?.kind && owner?.name ? `${owner.kind}/${owner.name}` : fallback;
}

function selectorLabels(selector: KubeItem["spec"]["selector"]) {
  if (!selector || typeof selector !== "object") return {};
  if ("matchLabels" in selector) return selector.matchLabels ?? {};
  return selector as Record<string, string>;
}

async function restartArgs(target: { name: string; namespace: string; cluster: string }) {
  const owner = await kubectlText([
    "get",
    "pod",
    target.name,
    "-n",
    target.namespace,
    "-o",
    "jsonpath={.metadata.ownerReferences[0].kind}/{.metadata.ownerReferences[0].name}",
  ], target.cluster);
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

function kubectlArgs(args: string[], context: string) {
  return context ? ["--context", context, ...args] : args;
}

function displayKubectlCommand(args: string[], context: string) {
  return `kubectl ${kubectlArgs(args, context).map(shellQuote).join(" ")}`;
}

function helmArgs(args: string[], context: string) {
  return context ? [...args, "--kube-context", context] : args;
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
    return podStatus(item);
  }

  if (item.kind === "Deployment") {
    if ((item.status?.unavailableReplicas ?? 0) > 0) return "warning";
    return "healthy";
  }

  return "healthy";
}

function resourceDiagnostic(item: KubeItem) {
  if (item.kind !== "Pod") return "";
  return podDiagnostic(item);
}

function podStatus(item: KubeItem) {
  const phase = item.status?.phase ?? "";
  const containers = item.status?.containerStatuses ?? [];
  const allContainers = [
    ...(item.status?.initContainerStatuses ?? []),
    ...containers,
    ...(item.status?.ephemeralContainerStatuses ?? []),
  ];
  const restarts = allContainers.reduce((sum, status) => sum + (status.restartCount ?? 0), 0);

  if (phase === "Failed") return "critical";
  if (phase !== "Succeeded" && allContainers.some(hasCriticalContainerState)) return "critical";
  if (phase === "Succeeded") return "healthy";
  if (phase === "Running" && containers.length > 0 && containers.every((container) => container.ready) && restarts === 0) {
    return "healthy";
  }

  return "warning";
}

function podDiagnostic(item: KubeItem) {
  const phase = item.status?.phase ?? "";
  const diagnostic =
    containerStatusDiagnostic(item.status?.initContainerStatuses) ??
    containerStatusDiagnostic(item.status?.containerStatuses) ??
    containerStatusDiagnostic(item.status?.ephemeralContainerStatuses);

  if (diagnostic) return diagnostic;
  if (item.status?.reason && item.status.reason !== phase) return item.status.reason;
  if (item.status?.message) return item.status.message;
  if (phase && phase !== "Running" && phase !== "Succeeded") return phase;

  const restarts = [
    ...(item.status?.initContainerStatuses ?? []),
    ...(item.status?.containerStatuses ?? []),
    ...(item.status?.ephemeralContainerStatuses ?? []),
  ].reduce((sum, status) => sum + (status.restartCount ?? 0), 0);

  if (restarts > 0) return `${restarts} restarts`;
  if ((item.status?.containerStatuses ?? []).some((container) => !container.ready)) {
    return "containers not ready";
  }
  return "";
}

function containerStatusDiagnostic(statuses?: KubeContainerStatus[]) {
  return (statuses ?? []).map((container) => {
    const name = container.name || "container";
    const waiting = container.state?.waiting;
    if (waiting?.reason || waiting?.message) {
      return `${name} ${waiting.reason || waiting.message}`;
    }

    const terminated = container.state?.terminated;
    if (terminated?.reason || terminated?.message) {
      return `${name} ${terminated.reason || terminated.message}`;
    }

    return "";
  }).find(Boolean);
}

function hasCriticalContainerState(container: KubeContainerStatus) {
  const waitingReason = container.state?.waiting?.reason ?? "";
  return criticalPodContainerReasons.has(waitingReason);
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
