import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, Box, CheckCircle2, FileText, GitCommitHorizontal, RotateCw, Skull, TerminalSquare } from "lucide-react";
import type { ContainerDetails, PodActionResult, ResourceDetails, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

const ansiPattern = /\u001b\[[0-9;]*m/g;
const logPrefixPattern = /^\[?([^\]\s]+\/[^\]\s]+(?:\/[^\]\s]+)?)\]?\s+(.*)$/;
const leadingTimestampPattern = /^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/;
const embeddedTimestampPattern = /(?:^|\s)(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/;

type ResourceDetailProps = {
  allResources: ResourceRow[];
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  result: PodActionResult | null;
  resource: ResourceRow;
  onBack: () => void;
  onOpenResource: (id: string) => void;
  onRefreshDetails: () => void;
  onRunPodAction: (action: string, confirmed?: boolean) => void;
};

export function ResourceDetail({
  allResources,
  details,
  detailsError,
  detailsLoading,
  onBack,
  onOpenResource,
  onRefreshDetails,
  onRunPodAction,
  resource,
  result,
}: ResourceDetailProps) {
  const isPod = resource.kind === "Pod";
  const hierarchyGroups = useMemo(() => hierarchyFor(resource, allResources), [allResources, resource]);

  useEffect(() => {
    if (!isPod) {
      return;
    }

    onRefreshDetails();
    const interval = window.setInterval(onRefreshDetails, 4_000);
    return () => window.clearInterval(interval);
  }, [isPod, onRefreshDetails, resource.id]);

  return (
    <section className="detail-workspace">
      <header className="detail-hero">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={15} />
          Resources
        </button>
        <div>
          <span className="detail-kind">
            <StatusDot state={resource.status} />
            {resource.kind} / {resource.namespace}
          </span>
          <h2>{resource.name}</h2>
        </div>
      </header>

      {isPod ? (
        <>
          <PodStatusPanel details={details} resource={resource} />
          <div className="pod-actions" aria-label="Pod actions">
            <button type="button" onClick={onRefreshDetails}>
              <FileText size={15} />
              Logs
            </button>
            <button type="button" onClick={() => onRunPodAction("exec")}>
              <TerminalSquare size={15} />
              Exec
            </button>
            <button type="button" onClick={() => onRunPodAction("restart")}>
              <RotateCw size={15} />
              Restart
            </button>
            <button className="danger" type="button" onClick={() => onRunPodAction("delete")}>
              <Skull size={15} />
              Kill
            </button>
          </div>
        </>
      ) : null}

      {result ? <ActionResult result={result} onConfirm={() => onRunPodAction(result.action, true)} /> : null}

      {isPod ? (
        <PodTerminal details={details} detailsError={detailsError} detailsLoading={detailsLoading} />
      ) : (
        <HierarchyGroups groups={hierarchyGroups} onOpenResource={onOpenResource} />
      )}
    </section>
  );
}

function PodStatusPanel({ details, resource }: { details: ResourceDetails; resource: ResourceRow }) {
  const pod = details.pod;
  const containers = pod?.containers ?? [];
  const ready = pod ? `${pod.readyContainers}/${pod.totalContainers || containers.length}` : "syncing";
  const restartTotal = containers.reduce((sum, container) => sum + container.restartCount, resource.restarts);

  return (
    <section className="pod-debug-panel" aria-label="Pod runtime status">
      <div className="pod-vitals">
        <RuntimeTile icon={Activity} label="Phase" value={pod?.phase ?? resource.status} tone={resource.status} />
        <RuntimeTile icon={CheckCircle2} label="Ready" value={ready} tone={pod?.readyContainers === pod?.totalContainers ? "healthy" : "warning"} />
        <RuntimeTile icon={RotateCw} label="Restarts" value={String(restartTotal)} tone={restartTotal > 0 ? "warning" : "healthy"} />
        <RuntimeTile icon={GitCommitHorizontal} label="Node" value={pod?.nodeName || "pending"} tone="syncing" />
      </div>

      <div className="container-strip">
        {containers.length ? (
          containers.map((container) => <ContainerCard container={container} key={container.name} />)
        ) : (
          <div className="container-card muted">
            <Box size={15} />
            <span>Container status syncing</span>
          </div>
        )}
      </div>
    </section>
  );
}

function RuntimeTile({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof Activity;
  label: string;
  tone: "healthy" | "warning" | "critical" | "syncing" | string;
  value: string;
}) {
  return (
    <article className={`runtime-tile ${tone}`}>
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ContainerCard({ container }: { container: ContainerDetails }) {
  return (
    <article className={container.ready ? "container-card ready" : "container-card warn"}>
      <div>
        <StatusDot state={container.ready ? "healthy" : "warning"} />
        <strong>{container.name}</strong>
      </div>
      <span>{container.state}{container.reason ? ` / ${container.reason}` : ""}</span>
      <small>{container.restartCount} restarts</small>
    </article>
  );
}

function ActionResult({ onConfirm, result }: { onConfirm: () => void; result: PodActionResult }) {
  return (
    <div className={`pod-action-result ${result.status}`}>
      <div>
        <span>{result.status}</span>
        <strong>{result.message}</strong>
        {result.command ? <code>{result.command}</code> : null}
      </div>
      {result.requiresConfirmation ? (
        <button type="button" onClick={onConfirm}>
          Confirm
        </button>
      ) : null}
    </div>
  );
}

function PodTerminal({
  details,
  detailsError,
  detailsLoading,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
}) {
  const logView = useMemo(() => {
    const lines = parseLogLines(terminalOutput(details, detailsLoading, detailsError));
    let errors = 0;
    let warnings = 0;

    for (const line of lines) {
      if (line.level === "error") {
        errors += 1;
      } else if (line.level === "warn") {
        warnings += 1;
      }
    }

    return { errors, lines, warnings };
  }, [details.logs, detailsError, detailsLoading]);

  return (
    <section className="terminal-panel">
      <header>
        <div>
          <span>Live tail</span>
          <strong>{detailsLoading ? "syncing" : `${logView.lines.length} lines`}</strong>
        </div>
        <div className="log-meters" aria-label="Log signal summary">
          <span className="ok">stream</span>
          {logView.warnings ? <span className="warn">{logView.warnings} warn</span> : null}
          {logView.errors ? <span className="error">{logView.errors} error</span> : null}
        </div>
      </header>
      <div className="terminal-frame">
        <div className="terminal-chrome">
          <i />
          <i />
          <i />
          <span>kubectl logs --all-containers --prefix --tail=240</span>
        </div>
        <div className="terminal-output" role="log" aria-live="polite">
          {logView.lines.map((line, index) => (
            <div className={`log-line ${line.level}`} key={`${line.raw}-${index}`}>
              <span className="log-number">{index + 1}</span>
              <time>{line.time}</time>
              <span className="log-source">{line.source}</span>
              <span className="log-level">{line.level}</span>
              <code>{line.message}</code>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function terminalOutput(details: ResourceDetails, detailsLoading: boolean, detailsError: string) {
  if (detailsLoading && !details.logs) {
    return "Connecting to pod log stream...";
  }
  return details.logs || detailsError || "No log lines returned yet.";
}

function parseLogLines(output: string) {
  return output.split(/\r?\n/).filter(Boolean).map((raw) => {
    const clean = raw.replace(ansiPattern, "");
    const prefixMatch = clean.match(logPrefixPattern);
    const source = compactLogSource(prefixMatch?.[1] ?? "pod");
    const body = prefixMatch?.[2] ?? clean;
    const timeMatch = body.match(leadingTimestampPattern) ?? body.match(embeddedTimestampPattern);
    const time = timeMatch?.[1] ? formatLogTime(timeMatch[1]) : "";
    const message = timeMatch?.[2] ?? body;
    const lower = message.toLowerCase();
    const level = lower.includes("error") || lower.includes("exception") || lower.includes("fatal")
      ? "error"
      : lower.includes("warn")
        ? "warn"
        : lower.includes("debug")
          ? "debug"
          : "info";

    return {
      raw,
      time,
      source,
      level,
      message,
    };
  });
}

function compactLogSource(source: string) {
  const parts = source.replace(/^\[/, "").replace(/\]$/, "").split("/");
  return parts.length >= 3 ? `${parts.at(-2)}/${parts.at(-1)}` : source;
}

function formatLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace("T", " ").replace("Z", "");
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type HierarchyGroup = {
  title: string;
  resources: ResourceRow[];
};

function HierarchyGroups({
  groups,
  onOpenResource,
}: {
  groups: HierarchyGroup[];
  onOpenResource: (id: string) => void;
}) {
  const visibleGroups = useMemo(() => groups.filter((group) => group.resources.length > 0), [groups]);
  const groupSignature = useMemo(
    () => visibleGroups.map((group) => `${group.title}:${group.resources.length}`).join("|"),
    [visibleGroups],
  );
  const firstGroupTitle = visibleGroups[0]?.title ?? "";
  const [activeTitle, setActiveTitle] = useState("");
  const activeGroup = visibleGroups.find((group) => group.title === activeTitle) ?? visibleGroups[0];

  useEffect(() => {
    setActiveTitle(firstGroupTitle);
  }, [firstGroupTitle, groupSignature]);

  if (!visibleGroups.length) {
    return (
      <div className="empty-state">
        <strong>No child resources found</strong>
        <span>This object has no obvious runtime hierarchy yet.</span>
      </div>
    );
  }

  return (
    <section className="hierarchy-groups">
      {visibleGroups.length > 1 ? (
        <div className="hierarchy-tabs" role="tablist" aria-label="Related resource groups">
          {visibleGroups.map((group) => (
            <button
              aria-selected={group.title === activeGroup.title}
              className={group.title === activeGroup.title ? "active" : ""}
              key={group.title}
              role="tab"
              type="button"
              onClick={() => setActiveTitle(group.title)}
            >
              <span>{group.title}</span>
              <strong>{group.resources.length}</strong>
            </button>
          ))}
        </div>
      ) : null}

      <section className="hierarchy-group" key={activeGroup.title}>
          <header>
            <span>{activeGroup.title}</span>
            <strong>{activeGroup.resources.length}</strong>
          </header>
          <div className="hierarchy-table">
            {activeGroup.resources.map((child) => (
              <button key={child.id} type="button" onClick={() => onOpenResource(child.id)}>
                <span className="name-cell">
                  <StatusDot state={child.status} />
                  <strong>{child.name}</strong>
                </span>
                <span>{child.kind}</span>
                <span>{child.age}</span>
              </button>
            ))}
          </div>
      </section>
    </section>
  );
}

const workloadKinds = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ReplicaSet"]);
const trafficKinds = new Set(["Service", "Ingress", "Gateway", "HTTPRoute"]);
const configKinds = new Set(["ConfigMap", "Secret", "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"]);
const storageKinds = new Set(["PersistentVolumeClaim", "PersistentVolume", "StorageClass"]);

function hierarchyFor(resource: ResourceRow, resources: ResourceRow[]): HierarchyGroup[] {
  if (resource.kind === "Namespace") {
    const scoped = resources.filter((item) => item.namespace === resource.name && item.id !== resource.id);
    return [
      { title: "Workloads", resources: scoped.filter((item) => workloadKinds.has(item.kind)) },
      { title: "Services and routes", resources: scoped.filter((item) => trafficKinds.has(item.kind)) },
      { title: "Pods", resources: scoped.filter((item) => item.kind === "Pod") },
      { title: "Config and access", resources: scoped.filter((item) => configKinds.has(item.kind)) },
      { title: "Storage", resources: scoped.filter((item) => storageKinds.has(item.kind)) },
      { title: "Packages", resources: scoped.filter((item) => item.kind === "HelmRelease") },
    ];
  }

  if (resource.kind === "Service") {
    const namespacePods = resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace);
    const selectedPods = namespacePods.filter((item) => matchesSelector(item, resource.selector));
    const pods = selectedPods.length ? selectedPods : namespacePods;
    return [
      { title: selectedPods.length ? "Selected pods" : "Pods in namespace", resources: pods },
      { title: "Workloads in namespace", resources: workloadsForPods(pods, resources) },
      { title: "Routes in namespace", resources: resources.filter((item) => item.namespace === resource.namespace && ["Ingress", "Gateway", "HTTPRoute"].includes(item.kind)) },
      { title: "Config nearby", resources: resources.filter((item) => item.namespace === resource.namespace && ["ConfigMap", "Secret", "HelmRelease"].includes(item.kind)) },
    ];
  }

  if (workloadKinds.has(resource.kind)) {
    const pods = resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace && ownsPod(resource, item));
    const services = resources.filter(
      (item) =>
        item.kind === "Service" &&
        item.namespace === resource.namespace &&
        (matchesSelector(resource, item.selector) || pods.some((pod) => matchesSelector(pod, item.selector))),
    );
    return [
      { title: "Pods", resources: pods },
      { title: "Services", resources: services },
      { title: "Config nearby", resources: resources.filter((item) => item.namespace === resource.namespace && ["ConfigMap", "Secret"].includes(item.kind)) },
    ];
  }

  if (trafficKinds.has(resource.kind)) {
    return [
      { title: "Services", resources: resources.filter((item) => item.kind === "Service" && item.namespace === resource.namespace) },
      { title: "Pods in namespace", resources: resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace) },
    ];
  }

  return [
    { title: "Pods in namespace", resources: resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace) },
    { title: "Workloads in namespace", resources: resources.filter((item) => item.namespace === resource.namespace && workloadKinds.has(item.kind)) },
  ];
}

function ownsPod(owner: ResourceRow, pod: ResourceRow) {
  if (pod.owner.includes(`/${owner.name}`)) {
    return true;
  }
  if (owner.kind === "Deployment" && pod.owner.startsWith(`ReplicaSet/${owner.name}-`)) {
    return true;
  }
  return matchesSelector(pod, owner.selector) || matchesSelector(pod, owner.labels);
}

function workloadsForPods(pods: ResourceRow[], resources: ResourceRow[]) {
  return resources.filter((item) => workloadKinds.has(item.kind) && pods.some((pod) => ownsPod(item, pod)));
}

function matchesSelector(resource: ResourceRow, selector: Record<string, string>) {
  const entries = Object.entries(selector);
  return entries.length > 0 && entries.every(([key, value]) => resource.labels[key] === value);
}
