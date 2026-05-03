import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

type KubeItem = {
  addressType?: string;
  endpoints?: KubeEndpoint[];
  kind?: string;
  message?: string;
  reason?: string;
  type?: string;
  involvedObject?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
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
  subjects?: KubeSubject[];
  spec?: {
    affinity?: Record<string, unknown>;
    egress?: unknown[];
    ingress?: unknown[];
    nodeSelector?: Record<string, string | number | boolean>;
    providerID?: string;
    storageClassName?: string;
    volumeName?: string;
    containers?: KubeContainerSpec[];
    ephemeralContainers?: KubeContainerSpec[];
    initContainers?: KubeContainerSpec[];
    nodeName?: string;
    priorityClassName?: string;
    runtimeClassName?: string;
    schedulerName?: string;
    schedulingGates?: Array<{ name?: string }>;
    imagePullSecrets?: Array<{ name?: string }>;
    selector?: Record<string, string> | {
      matchExpressions?: unknown[];
      matchLabels?: Record<string, string>;
    };
    serviceAccountName?: string;
    maxReplicas?: number;
    minReplicas?: number;
    policyTypes?: string[];
    scaleTargetRef?: {
      kind?: string;
      name?: string;
    };
    tolerations?: KubeToleration[];
    type?: string;
    volumes?: KubeVolume[];
    claimRef?: { namespace?: string; name?: string };
    defaultBackend?: KubeIngressBackend;
    template?: { spec?: { containers?: KubeContainerSpec[] } };
    rules?: Array<{
      backendRefs?: KubeGatewayBackendRef[];
      host?: string;
      http?: { paths?: Array<{ backend?: KubeIngressBackend }> };
    }>;
  };
  ports?: unknown[];
  provisioner?: string;
  reclaimPolicy?: string;
  automountServiceAccountToken?: boolean;
  imagePullSecrets?: Array<{ name?: string }>;
  secrets?: Array<{ name?: string }>;
  status?: {
    phase?: string;
    podIP?: string;
    hostIP?: string;
    qosClass?: string;
    startTime?: string;
    replicas?: number;
    availableReplicas?: number;
    currentReplicas?: number;
    desiredReplicas?: number;
    readyReplicas?: number;
    unavailableReplicas?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
    containerStatuses?: KubeContainerStatus[];
    ephemeralContainerStatuses?: KubeContainerStatus[];
    initContainerStatuses?: KubeContainerStatus[];
    reason?: string;
    message?: string;
  };
};

type KubeEndpoint = {
  conditions?: {
    ready?: boolean;
    serving?: boolean;
    terminating?: boolean;
  };
  targetRef?: {
    kind?: string;
    name?: string;
    namespace?: string;
  };
};

type KubeSubject = {
  kind?: string;
  name?: string;
  namespace?: string;
};

type KubeContainerStatus = {
  name?: string;
  image?: string;
  ready?: boolean;
  restartCount?: number;
  state?: Record<string, ContainerStateDetails>;
  lastState?: Record<string, ContainerStateDetails>;
};

type KubeContainerSpec = {
  env?: KubeEnvVar[];
  envFrom?: KubeEnvFromSource[];
  image?: string;
  name?: string;
  ports?: Array<{ containerPort?: number }>;
  livenessProbe?: KubeProbe;
  readinessProbe?: KubeProbe;
  startupProbe?: KubeProbe;
  resources?: {
    requests?: Record<string, string | number>;
    limits?: Record<string, string | number>;
  };
};

type KubeEnvFromSource = {
  configMapRef?: { name?: string };
  secretRef?: { name?: string };
};

type KubeEnvVar = {
  valueFrom?: {
    configMapKeyRef?: { name?: string };
    secretKeyRef?: { name?: string };
  };
};

type KubeProbe = {
  exec?: { command?: string[] };
  grpc?: { port?: string | number };
  httpGet?: { path?: string; port?: string | number };
  tcpSocket?: { port?: string | number };
};

type KubeToleration = {
  effect?: string;
  key?: string;
  operator?: string;
  value?: string;
};

type ContainerStateDetails = {
  reason?: string;
  message?: string;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
};

type KubeVolume = {
  configMap?: { name?: string };
  persistentVolumeClaim?: { claimName?: string };
  secret?: { secretName?: string };
};

type KubeGatewayBackendRef = {
  group?: string;
  kind?: string;
  name?: string;
  namespace?: string;
};

type KubeIngressBackend = {
  service?: { name?: string };
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
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  metadata?: { creationTimestamp?: string };
};

const resourceQueries = [
  { name: "pods", namespaced: true },
  { name: "deployments.apps", namespaced: true },
  { name: "replicasets.apps", namespaced: true },
  { name: "statefulsets.apps", namespaced: true },
  { name: "daemonsets.apps", namespaced: true },
  { name: "jobs.batch", namespaced: true },
  { name: "cronjobs.batch", namespaced: true },
  { name: "horizontalpodautoscalers.autoscaling", namespaced: true },
  { name: "services", namespaced: true },
  { name: "endpointslices.discovery.k8s.io", namespaced: true },
  { name: "events", namespaced: true },
  { name: "ingresses.networking.k8s.io", namespaced: true },
  { name: "networkpolicies.networking.k8s.io", namespaced: true },
  { name: "gateways.gateway.networking.k8s.io", namespaced: true },
  { name: "httproutes.gateway.networking.k8s.io", namespaced: true },
  { name: "configmaps", namespaced: true },
  { name: "secrets", namespaced: true },
  { name: "serviceaccounts", namespaced: true },
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
  annotateServiceBackends(resources);
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
    namespaceHeat: namespaces.map((namespace) => toNamespaceHeat(namespace, resources)),
    resources,
  };
}

export async function readResourceDetails(target: { kind: string; name: string; namespace: string; cluster: string }) {
  if (target.kind === "HelmRelease") {
    return readHelmDetails(target);
  }
  if (target.kind === "Event") {
    return readEventDetails(target);
  }

  const [yaml, describe, events, pod, logs, previousLogs] = await Promise.all([
    readResourceYaml(target).catch((error) => errorMessage(error)),
    readResourceDescribe(target).catch((error) => errorMessage(error)),
    readResourceEvents(target).catch(() => []),
    target.kind === "Pod" ? readPodDetails(target).catch(() => undefined) : undefined,
    target.kind === "Pod" ? readPodLogs(target).catch((error) => errorMessage(error)) : "",
    target.kind === "Pod" ? readPodLogs(target, true).catch(() => "") : "",
  ]);

  return { yaml, describe, events, logs, previousLogs, pod };
}

export async function runPodAction(input: {
  action: string;
  confirmed: boolean;
  target: { kind: string; name: string; namespace: string; cluster: string };
}) {
  const action = input.action.toLowerCase();
  const actionName = action.split(":", 1)[0];
  const { target } = input;

  if (target.kind !== "Pod") {
    if (actionName === "restart" && isRestartableWorkloadKind(target.kind)) {
      if (!isLocalContext(target.cluster)) {
        return podActionResult(action, "blocked", `${target.cluster} is not recognized as a local context.`);
      }

      const args = rolloutRestartArgs(target.kind, target.name, target.namespace);
      const command = displayKubectlCommand(args, target.cluster);
      if (!input.confirmed) {
        return podActionResult(action, "blocked", `Confirm to restart ${target.namespace}/${target.name}.`, "", command, true);
      }

      return kubectlText(args, target.cluster)
        .then((output) => podActionResult(action, "executed", "Action completed.", output, command))
        .catch((error) => podActionResult(action, "failed", errorMessage(error), "", command));
    }

    return podActionResult(action, "blocked", "This action only runs against pods.");
  }

  if (actionName === "logs") {
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

  if (actionName === "exec") {
    const container = requestedContainerForExecAction(action);
    if (container === null) {
      return podActionResult(action, "blocked", `Invalid container name for ${action}.`);
    }

    const command = podExecCommand(target, container);
    return openTerminal(command)
      .then(() => podActionResult(action, "executed", execOpenedMessage(container), "", command))
      .catch((error) => podActionResult(action, "ready", `${errorMessage(error)} Run this command manually.`, "", command));
  }

  if (actionName === "port-forward") {
    const requestedPort = requestedPortForAction(action);
    if (requestedPort === null) {
      return podActionResult(action, "blocked", `Invalid pod port for ${action}.`);
    }

    const port = requestedPort ?? await firstPodPort(target).catch(() => 0);
    if (!port) {
      return podActionResult(action, "blocked", "Pod has no declared container ports.");
    }

    const args = ["port-forward", "-n", target.namespace, `pod/${target.name}`, `:${port}`];
    const command = displayKubectlCommand(args, target.cluster);
    return openTerminal(command)
      .then(() => podActionResult(action, "executed", `Opened Terminal forwarding to pod port ${port}.`, "", command))
      .catch((error) => podActionResult(action, "ready", `${errorMessage(error)} Run this command manually.`, "", command));
  }

  if (actionName === "restart" || actionName === "delete" || actionName === "kill") {
    if (!isLocalContext(target.cluster)) {
      return podActionResult(action, "blocked", `${target.cluster} is not recognized as a local context.`);
    }

    const args = actionName === "restart"
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

function requestedPortForAction(action: string) {
  const delimiter = action.indexOf(":");
  if (delimiter === -1) {
    return undefined;
  }

  const port = action.slice(delimiter + 1);
  const parsed = Number(port);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : null;
}

function requestedContainerForExecAction(action: string) {
  const delimiter = action.indexOf(":");
  if (delimiter === -1) {
    return undefined;
  }

  const container = action.slice(delimiter + 1).trim();
  return container ? container : null;
}

function execOpenedMessage(container: string | undefined) {
  return container
    ? `Opened Terminal with an interactive shell in container ${container}.`
    : "Opened Terminal with an interactive pod shell.";
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
    backendReady: false,
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
    describe: status,
    events: status ? [{ type: "Normal", reason: "HelmStatus", message: status, age: "live", count: 1 }] : [],
    logs: "",
    previousLogs: "",
  };
}

async function readResourceDescribe(target: { kind: string; name: string; namespace: string; cluster: string }) {
  const args = ["describe", target.kind, target.name];
  if (target.namespace && target.namespace !== "cluster") {
    args.splice(3, 0, "-n", target.namespace);
  }
  return kubectlText(args, target.cluster);
}

async function readResourceYaml(target: { kind: string; name: string; namespace: string; cluster: string }) {
  const args = ["get", target.kind, target.name, "-o", "yaml"];
  if (target.namespace && target.namespace !== "cluster") {
    args.splice(3, 0, "-n", target.namespace);
  }
  return kubectlText(args, target.cluster);
}

async function readResourceJson<T>(target: { kind: string; name: string; namespace: string; cluster: string }) {
  const args = ["get", target.kind, target.name, "-o", "json"];
  if (target.namespace && target.namespace !== "cluster") {
    args.splice(3, 0, "-n", target.namespace);
  }
  return kubectlJson<T>(args, target.cluster);
}

async function readEventDetails(target: { kind: string; name: string; namespace: string; cluster: string }) {
  const [yaml, describe, event] = await Promise.all([
    readResourceYaml(target).catch((error) => errorMessage(error)),
    readResourceDescribe(target).catch((error) => errorMessage(error)),
    readResourceJson<KubeEvent>(target).catch(() => undefined),
  ]);

  return {
    yaml,
    describe,
    events: event ? [toResourceEvent(event)] : [],
    logs: "",
    previousLogs: "",
  };
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
  return (list.items ?? []).map(toResourceEvent);
}

function toResourceEvent(event: KubeEvent) {
  return {
    type: event.type ?? "Normal",
    reason: event.reason ?? "Event",
    message: event.message ?? "",
    age: age(event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp),
    count: positiveCount(event.count),
  };
}

function positiveCount(count: number | undefined) {
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
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
    ...containerDetails(pod.status?.initContainerStatuses, "init", pod.spec?.initContainers),
    ...containerDetails(appContainers, "app", pod.spec?.containers),
    ...containerDetails(pod.status?.ephemeralContainerStatuses, "ephemeral", pod.spec?.ephemeralContainers),
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
    scheduling: podScheduling(pod.spec),
  };
}

function podScheduling(spec: KubeItem["spec"]) {
  return {
    nodeSelector: Object.fromEntries(
      Object.entries(spec?.nodeSelector ?? {})
        .map(([key, value]) => [key, String(value)])
        .filter(([, value]) => value),
    ),
    priorityClassName: spec?.priorityClassName ?? "",
    schedulerName: spec?.schedulerName ?? "default-scheduler",
    serviceAccountName: spec?.serviceAccountName ?? "default",
    tolerations: (spec?.tolerations ?? []).map(tolerationSummary).filter(Boolean).slice(0, 6),
    affinity: affinitySummaries(spec?.affinity),
    schedulingGates: (spec?.schedulingGates ?? []).map((gate) => gate.name ?? "").filter(Boolean).slice(0, 6),
    runtimeClassName: spec?.runtimeClassName ?? "",
  };
}

function tolerationSummary(toleration: KubeToleration) {
  const comparison = toleration.value ? `=${toleration.value}` : toleration.operator ?? "";
  const selector = toleration.key ? `${toleration.key}${comparison}` : "all";
  return toleration.effect ? `${selector}:${toleration.effect}` : selector;
}

function affinitySummaries(affinity: Record<string, unknown> | undefined) {
  if (!affinity) {
    return [];
  }

  return [
    ["node", "nodeAffinity"],
    ["pod", "podAffinity"],
    ["anti-pod", "podAntiAffinity"],
  ]
    .filter(([, field]) => Boolean(affinity[field]))
    .map(([label]) => label);
}

function containerDetails(
  containers: KubeContainerStatus[] | undefined,
  role: "app" | "init" | "ephemeral",
  specs: KubeContainerSpec[] = [],
) {
  const statuses = containers ?? [];
  const details = specs.map((spec) => {
    const container = statuses.find((status) => status.name === spec.name);
    return containerDetail(container, role, spec);
  });

  for (const container of statuses) {
    if (!specs.some((spec) => spec.name === container.name)) {
      details.push(containerDetail(container, role));
    }
  }

  return details;
}

function containerDetail(
  container: KubeContainerStatus | undefined,
  role: "app" | "init" | "ephemeral",
  spec?: KubeContainerSpec,
) {
  const stateName = Object.keys(container?.state ?? {})[0] ?? "unknown";
  const state = container?.state?.[stateName] ?? {};
  const lastTerminated = container?.lastState?.terminated ?? {};
  return {
    name: container?.name ?? spec?.name ?? "container",
    role,
    image: container?.image ?? spec?.image ?? "",
    ports: containerPorts(spec),
    probes: containerProbes(spec),
    requests: containerResources(spec, "requests"),
    limits: containerResources(spec, "limits"),
    ready: Boolean(container?.ready),
    restartCount: container?.restartCount ?? 0,
    state: container ? stateName : "pending",
    reason: state.reason ?? (container ? "" : "status pending"),
    message: state.message ?? "",
    exitCode: state.exitCode ?? null,
    startedAt: state.startedAt ?? "",
    finishedAt: state.finishedAt ?? "",
    lastReason: lastTerminated.reason ?? "",
    lastExitCode: lastTerminated.exitCode ?? null,
    lastStartedAt: lastTerminated.startedAt ?? "",
    lastFinishedAt: lastTerminated.finishedAt ?? "",
  };
}

function containerProbes(container?: KubeContainerSpec) {
  return [
    probeSummary("readiness", container?.readinessProbe),
    probeSummary("liveness", container?.livenessProbe),
    probeSummary("startup", container?.startupProbe),
  ].filter((probe): probe is { kind: string; check: string } => Boolean(probe));
}

function probeSummary(kind: string, probe?: KubeProbe) {
  const check = probeCheck(probe);
  return check ? { kind, check } : null;
}

function probeCheck(probe?: KubeProbe) {
  if (probe?.httpGet) {
    return `http ${probe.httpGet.path || "/"}:${probePort(probe.httpGet.port)}`;
  }
  if (probe?.tcpSocket) {
    return `tcp ${probePort(probe.tcpSocket.port)}`;
  }
  if (probe?.grpc) {
    return `grpc ${probePort(probe.grpc.port)}`;
  }
  if (probe?.exec) {
    return `exec ${probe.exec.command?.slice(0, 3).join(" ") || "command"}`;
  }
  return "";
}

function probePort(port: string | number | undefined) {
  return port ? String(port) : "?";
}

function containerPorts(container?: KubeContainerSpec) {
  return (container?.ports ?? [])
    .map((port) => port.containerPort)
    .filter((port): port is number => Number.isInteger(port) && port > 0 && port <= 65_535);
}

function containerResources(container: KubeContainerSpec | undefined, field: "requests" | "limits") {
  return Object.fromEntries(
    Object.entries(container?.resources?.[field] ?? {})
      .map(([name, value]) => [name, String(value)])
      .filter(([, value]) => value),
  );
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
    lastRestartAt: item.kind === "Pod" ? podLastRestartAt(item) : "",
    owner: ownerForResource(item, namespace),
    image: resourceImage(item),
    nodeName: item.kind === "Pod" ? item.spec?.nodeName ?? "" : "",
    diagnostic: resourceDiagnostic(item),
    backendReady: item.kind === "Pod" && podBackendReady(item),
    labels: item.metadata?.labels ?? {},
    references: resourceReferences(item, namespace),
    selector: selectorLabels(item.spec?.selector),
  };
}

function resourceReferences(item: KubeItem, namespace: string) {
  if (item.kind === "Event") {
    return eventReferences(item, namespace);
  }
  if (item.kind === "EndpointSlice") {
    return endpointSliceReferences(item, namespace);
  }
  if (item.kind === "HTTPRoute") {
    return httpRouteBackendReferences(item, namespace);
  }
  if (item.kind === "Ingress") {
    return ingressBackendReferences(item, namespace);
  }
  if (item.kind === "HorizontalPodAutoscaler") {
    return scaleTargetReference(item, namespace);
  }
  if (item.kind === "Pod") {
    return uniqueReferences([
      ...volumeReferences(item, namespace),
      ...serviceAccountReferences(item, namespace),
      ...imagePullSecretReferences(item, namespace),
      ...envReferences(item, namespace),
    ]);
  }
  if (item.kind === "RoleBinding" || item.kind === "ClusterRoleBinding") {
    return bindingSubjectReferences(item, namespace);
  }
  return volumeReferences(item, namespace);
}

function scaleTargetReference(item: KubeItem, namespace: string) {
  const target = item.spec?.scaleTargetRef;
  return target?.kind && target.name ? [{ kind: target.kind, namespace, name: target.name }] : [];
}

function httpRouteBackendReferences(item: KubeItem, namespace: string) {
  return uniqueReferences((item.spec?.rules ?? []).flatMap((rule) =>
    (rule.backendRefs ?? [])
      .filter((reference) => (reference.kind ?? "Service") === "Service" && !reference.group)
      .map((reference) => ({
        kind: "Service",
        namespace: reference.namespace || namespace,
        name: reference.name ?? "",
      }))
  ));
}

function ingressBackendReferences(item: KubeItem, namespace: string) {
  const backends = [
    item.spec?.defaultBackend,
    ...(item.spec?.rules ?? []).flatMap((rule) => rule.http?.paths?.map((path) => path.backend) ?? []),
  ];

  return uniqueReferences(backends.flatMap((backend) => {
    const name = backend?.service?.name;
    return name ? [{ kind: "Service", namespace, name }] : [];
  }));
}

function eventReferences(item: KubeItem, fallbackNamespace: string) {
  const involved = item.involvedObject;
  if (!involved?.kind || !involved.name) {
    return [];
  }

  return [{
    kind: involved.kind,
    namespace: involved.namespace || fallbackNamespace,
    name: involved.name,
  }];
}

function endpointSliceReferences(item: KubeItem, namespace: string) {
  return uniqueReferences([
    ...(endpointSliceServiceName(item) ? [{ kind: "Service", namespace, name: endpointSliceServiceName(item) }] : []),
    ...(item.endpoints ?? []).flatMap((endpoint) => {
      const target = endpoint.targetRef;
      return target?.kind && target.name
        ? [{ kind: target.kind, namespace: target.namespace || namespace, name: target.name }]
        : [];
    }),
  ]);
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

function serviceAccountReferences(item: KubeItem, namespace: string) {
  const serviceAccountName = item.spec?.serviceAccountName;
  return serviceAccountName ? [{ kind: "ServiceAccount", namespace, name: serviceAccountName }] : [];
}

function imagePullSecretReferences(item: KubeItem, namespace: string) {
  return (item.spec?.imagePullSecrets ?? [])
    .filter((secret) => secret.name)
    .map((secret) => ({ kind: "Secret", namespace, name: secret.name ?? "" }));
}

function envReferences(item: KubeItem, namespace: string) {
  const references: Array<{ kind: string; namespace: string; name: string }> = [];
  const containers = [
    ...(item.spec?.initContainers ?? []),
    ...(item.spec?.containers ?? []),
    ...(item.spec?.ephemeralContainers ?? []),
  ];

  for (const container of containers) {
    for (const source of container.envFrom ?? []) {
      if (source.configMapRef?.name) {
        references.push({ kind: "ConfigMap", namespace, name: source.configMapRef.name });
      }
      if (source.secretRef?.name) {
        references.push({ kind: "Secret", namespace, name: source.secretRef.name });
      }
    }

    for (const variable of container.env ?? []) {
      if (variable.valueFrom?.configMapKeyRef?.name) {
        references.push({ kind: "ConfigMap", namespace, name: variable.valueFrom.configMapKeyRef.name });
      }
      if (variable.valueFrom?.secretKeyRef?.name) {
        references.push({ kind: "Secret", namespace, name: variable.valueFrom.secretKeyRef.name });
      }
    }
  }

  return references;
}

function uniqueReferences(references: Array<{ kind: string; namespace: string; name: string }>) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.kind}:${reference.namespace}:${reference.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function bindingSubjectReferences(item: KubeItem, fallbackNamespace: string) {
  return uniqueReferences((item.subjects ?? []).flatMap((subject) => {
    if (subject.kind !== "ServiceAccount" || !subject.name) {
      return [];
    }

    const namespace = subject.namespace || (fallbackNamespace === "cluster" ? "" : fallbackNamespace);
    return namespace ? [{ kind: "ServiceAccount", namespace, name: subject.name }] : [];
  }));
}

function ownerForResource(item: KubeItem, fallback: string) {
  if (item.kind === "Event") {
    const involved = eventReferences(item, fallback)[0];
    return involved ? `${involved.kind}/${involved.name}` : fallback;
  }

  if (item.kind === "EndpointSlice") {
    const serviceName = endpointSliceServiceName(item);
    return serviceName ? `Service/${serviceName}` : fallback;
  }

  if (item.kind === "PersistentVolumeClaim") {
    return item.spec?.volumeName ?? "";
  }

  if (item.kind === "PersistentVolume") {
    const claim = item.spec?.claimRef;
    return claim?.name ? `${claim.namespace || "default"}/${claim.name}` : "";
  }

  if (item.kind === "StorageClass") {
    return item.reclaimPolicy ?? "";
  }

  if (item.kind === "ServiceAccount") {
    return `${item.secrets?.length ?? 0} secrets / ${item.imagePullSecrets?.length ?? 0} pulls`;
  }

  if (item.kind === "HorizontalPodAutoscaler" && item.spec?.scaleTargetRef?.kind && item.spec.scaleTargetRef.name) {
    return `${item.spec.scaleTargetRef.kind}/${item.spec.scaleTargetRef.name}`;
  }

  if (item.kind === "NetworkPolicy") {
    return networkPolicyTypes(item).join("/") || "Ingress";
  }

  if ((item.kind === "RoleBinding" || item.kind === "ClusterRoleBinding") && item.roleRef?.kind && item.roleRef.name) {
    return `${item.roleRef.kind}/${item.roleRef.name}`;
  }

  const owner = item.metadata?.ownerReferences?.[0];
  return owner?.kind && owner?.name ? `${owner.kind}/${owner.name}` : fallback;
}

function resourceImage(item: KubeItem) {
  if (item.kind === "EndpointSlice") {
    return endpointSliceKindSummary(item);
  }
  if (item.kind === "PersistentVolumeClaim" || item.kind === "PersistentVolume") {
    return item.spec?.storageClassName ?? "";
  }
  if (item.kind === "StorageClass") {
    return item.provisioner ?? "";
  }
  if (item.kind === "ServiceAccount") {
    return item.automountServiceAccountToken === false ? "manual token" : "automount token";
  }
  if (item.kind === "HorizontalPodAutoscaler") {
    const min = item.spec?.minReplicas ?? 1;
    return item.spec?.maxReplicas ? `${min}-${item.spec.maxReplicas} replicas` : "";
  }
  if (item.kind === "NetworkPolicy") {
    const ingress = item.spec?.ingress?.length ?? 0;
    const egress = item.spec?.egress?.length ?? 0;
    return `${ingress} ingress / ${egress} egress`;
  }
  return item.status?.containerStatuses?.[0]?.image ??
    item.spec?.containers?.[0]?.image ??
    item.spec?.template?.spec?.containers?.[0]?.image ??
    "";
}

function selectorLabels(selector: KubeItem["spec"]["selector"]) {
  if (!selector || typeof selector !== "object") return {};
  if ("matchLabels" in selector) return selector.matchLabels ?? {};
  return selector as Record<string, string>;
}

function annotateServiceBackends(resources: Array<ReturnType<typeof toResource>>) {
  const pods = resources.filter((resource) => resource.kind === "Pod");

  for (const service of resources.filter((resource) => resource.kind === "Service")) {
    const selector = Object.entries(service.selector);
    if (!selector.length) {
      continue;
    }

    const selectedPods = pods.filter((pod) =>
      pod.namespace === service.namespace && selector.every(([key, value]) => pod.labels[key] === value)
    );

    if (!selectedPods.length) {
      markServiceBackendStatus(service, "critical", "no selected pods");
      continue;
    }

    const ready = selectedPods.filter((pod) => pod.backendReady).length;
    if (ready === selectedPods.length) {
      continue;
    }

    markServiceBackendStatus(
      service,
      ready === 0 ? "critical" : "warning",
      `${ready}/${selectedPods.length} backend pods ready`,
    );
  }
}

function markServiceBackendStatus(resource: ReturnType<typeof toResource>, status: "critical" | "warning", diagnostic: string) {
  const pressure = status === "critical" ? 70 : 44;

  resource.status = status;
  resource.diagnostic = diagnostic;
  resource.cpu = Math.max(resource.cpu, pressure);
  resource.memory = Math.min(100, resource.cpu + 8);
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

function isRestartableWorkloadKind(kind: string) {
  return ["Deployment", "StatefulSet", "DaemonSet"].includes(kind);
}

function rolloutRestartArgs(kind: string, name: string, namespace: string) {
  return ["rollout", "restart", `${kind.toLowerCase()}/${name}`, "-n", namespace];
}

async function firstPodPort(target: { name: string; namespace: string; cluster: string }) {
  const pod = await kubectlJson<KubeItem>(["get", "pod", target.name, "-n", target.namespace, "-o", "json"], target.cluster);
  const ports = [
    ...(pod.spec?.containers ?? []),
    ...(pod.spec?.initContainers ?? []),
    ...(pod.spec?.ephemeralContainers ?? []),
  ].flatMap(containerPorts);
  return ports[0] ?? 0;
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

function podExecCommand(target: { name: string; namespace: string; cluster: string }, container?: string) {
  const args = [
    "kubectl",
    "--context",
    target.cluster,
    "exec",
    "-n",
    target.namespace,
    "-it",
    target.name,
  ];
  if (container) {
    args.push("-c", container);
  }
  args.push("--", "/bin/sh");

  return args.map(shellQuote).join(" ");
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
    throw new Error("Terminal handoff is only wired to open Terminal on macOS for now.");
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

  if (item.kind === "EndpointSlice") {
    return endpointSliceStatus(item);
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

  if (item.kind === "ReplicaSet") {
    return workloadStatus(item.status?.readyReplicas ?? 0, item.spec?.replicas ?? 1);
  }

  if (item.kind === "HorizontalPodAutoscaler") {
    return hpaStatus(item);
  }

  return "healthy";
}

function workloadStatus(ready: number, desired: number) {
  if (desired === 0 || ready >= desired) return "healthy";
  if (ready === 0) return "critical";
  return "warning";
}

function hpaStatus(item: KubeItem) {
  const conditions = item.status?.conditions ?? [];
  if (conditions.some((condition) =>
    ["AbleToScale", "ScalingActive"].includes(condition.type ?? "") && condition.status === "False"
  )) {
    return "critical";
  }
  if (conditions.some((condition) => condition.type === "ScalingLimited" && condition.status === "True")) {
    return "warning";
  }
  return (item.status?.currentReplicas ?? 0) === (item.status?.desiredReplicas ?? 0) ? "healthy" : "warning";
}

function resourceDiagnostic(item: KubeItem) {
  if (item.kind === "Event") {
    return item.reason || item.message || "";
  }

  if (item.kind === "EndpointSlice") {
    return endpointSliceDiagnostic(item);
  }

  if (item.kind === "HorizontalPodAutoscaler") {
    return hpaDiagnostic(item);
  }

  if (item.kind === "NetworkPolicy") {
    return networkPolicySelectorSummary(item);
  }

  if (item.kind !== "Pod") return "";
  return podDiagnostic(item);
}

function hpaDiagnostic(item: KubeItem) {
  const conditions = item.status?.conditions ?? [];
  const blocked = conditions.find((condition) =>
    ["AbleToScale", "ScalingActive"].includes(condition.type ?? "") && condition.status === "False"
  );
  if (blocked) {
    return blocked.message || blocked.reason || `${blocked.type} false`;
  }

  const limited = conditions.find((condition) => condition.type === "ScalingLimited" && condition.status === "True");
  if (limited) {
    return limited.message || limited.reason || "Scaling limited";
  }

  const current = item.status?.currentReplicas ?? 0;
  const desired = item.status?.desiredReplicas ?? 0;
  return current === desired ? "" : `${current}/${desired} replicas`;
}

function networkPolicyTypes(item: KubeItem) {
  const types = item.spec?.policyTypes?.filter(Boolean) ?? [];
  if (types.length) return types;
  return item.spec?.egress ? ["Ingress", "Egress"] : ["Ingress"];
}

function networkPolicySelectorSummary(item: KubeItem) {
  const rawSelector = item.spec?.selector;
  if (rawSelector && "matchExpressions" in rawSelector && rawSelector.matchExpressions?.length) {
    return "selector expression";
  }

  const selector = selectorLabels(item.spec?.selector);
  const entries = Object.entries(selector);
  if (!entries.length) return "all pods";

  const visible = entries.slice(0, 2).map(([key, value]) => `${key}=${value}`).join(", ");
  return entries.length > 2 ? `${visible} +${entries.length - 2}` : visible;
}

function endpointSliceServiceName(item: KubeItem) {
  return item.metadata?.labels?.["kubernetes.io/service-name"] ?? "";
}

function endpointSliceReadyCount(item: KubeItem) {
  return (item.endpoints ?? []).filter((endpoint) => {
    const conditions = endpoint.conditions;
    return (conditions?.ready ?? true) && (conditions?.serving ?? true) && !(conditions?.terminating ?? false);
  }).length;
}

function endpointSliceStatus(item: KubeItem) {
  const endpointCount = item.endpoints?.length ?? 0;
  const readyCount = endpointSliceReadyCount(item);
  if (!endpointCount || !readyCount) return "critical";
  return readyCount === endpointCount ? "healthy" : "warning";
}

function endpointSliceDiagnostic(item: KubeItem) {
  const endpointCount = item.endpoints?.length ?? 0;
  const readyCount = endpointSliceReadyCount(item);
  if (!endpointCount) return "no endpoints";
  return readyCount === endpointCount ? "" : `${readyCount}/${endpointCount} endpoints ready`;
}

function endpointSliceKindSummary(item: KubeItem) {
  const portCount = item.ports?.length ?? 0;
  const ports = portCount === 1 ? "1 port" : `${portCount} ports`;
  return item.addressType ? `${item.addressType} · ${ports}` : ports;
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

function podBackendReady(item: KubeItem) {
  const containers = item.status?.containerStatuses ?? [];
  return item.status?.phase === "Running" && containers.length > 0 && containers.every((container) => container.ready);
}

function podLastRestartAt(item: KubeItem) {
  return [
    ...(item.status?.initContainerStatuses ?? []),
    ...(item.status?.containerStatuses ?? []),
    ...(item.status?.ephemeralContainerStatuses ?? []),
  ]
    .map((container) => container.lastState?.terminated?.finishedAt || container.lastState?.terminated?.startedAt || "")
    .filter(Boolean)
    .sort()
    .at(-1) ?? "";
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
