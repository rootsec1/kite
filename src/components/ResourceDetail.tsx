import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, Box, CheckCircle2, FileText, GitCommitHorizontal, RotateCw, Skull, Star, TerminalSquare } from "lucide-react";
import type { ContainerDetails, PodActionResult, ResourceDetails, ResourceRow } from "../types/kube";
import { PodTerminal } from "./PodTerminal";
import { StatusDot } from "./status";

type ResourceDetailProps = {
  allResources: ResourceRow[];
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  isPinned: boolean;
  result: PodActionResult | null;
  resource: ResourceRow;
  onBack: () => void;
  onOpenResource: (id: string) => void;
  onRefreshDetails: () => void;
  onRunPodAction: (action: string, confirmed?: boolean) => void;
  onTogglePinned: () => void;
};

export function ResourceDetail({
  allResources,
  details,
  detailsError,
  detailsLoading,
  isPinned,
  onBack,
  onOpenResource,
  onRefreshDetails,
  onRunPodAction,
  onTogglePinned,
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
        <div className="detail-actions">
          <button className="back-button" type="button" onClick={onBack}>
            <ArrowLeft size={15} />
            Resources
          </button>
          <button
            aria-pressed={isPinned}
            className={isPinned ? "pin-button active" : "pin-button"}
            type="button"
            onClick={onTogglePinned}
          >
            <Star size={15} fill={isPinned ? "currentColor" : "none"} />
            {isPinned ? "Pinned" : "Pin"}
          </button>
        </div>
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
  const failingConditions = pod?.conditions.filter((condition) => condition.status !== "True") ?? [];

  return (
    <section className="pod-debug-panel" aria-label="Pod runtime status">
      <div className="pod-status-line">
        <div>
          <StatusDot state={resource.status} />
          <strong>{pod?.phase ?? resource.status}</strong>
          <span>{ready} containers ready</span>
        </div>
        <small>
          {pod?.podIp ? `pod ${pod.podIp}` : "pod ip pending"}
          {pod?.qosClass ? ` / ${pod.qosClass}` : ""}
        </small>
      </div>

      <div className="pod-vitals">
        <RuntimeTile icon={Activity} label="Phase" value={pod?.phase ?? resource.status} tone={resource.status} />
        <RuntimeTile icon={CheckCircle2} label="Ready" value={ready} tone={pod?.readyContainers === pod?.totalContainers ? "healthy" : "warning"} />
        <RuntimeTile icon={RotateCw} label="Restarts" value={String(restartTotal)} tone={restartTotal > 0 ? "warning" : "healthy"} />
        <RuntimeTile icon={GitCommitHorizontal} label="Node" value={pod?.nodeName || "pending"} tone="syncing" />
      </div>

      {failingConditions.length ? (
        <div className="pod-conditions">
          {failingConditions.slice(0, 4).map((condition) => (
            <span key={condition.type}>
              {condition.type}: {condition.reason || condition.status}
            </span>
          ))}
        </div>
      ) : null}

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
  const visibleGroups = useMemo(() => groups.filter((group) => group.title), [groups]);
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
            {activeGroup.resources.length ? (
              activeGroup.resources.map((child) => (
                <button key={child.id} type="button" onClick={() => onOpenResource(child.id)}>
                  <span className="name-cell">
                    <StatusDot state={child.status} />
                    <strong>{child.name}</strong>
                  </span>
                  <span>{child.kind}</span>
                  <span>{child.age}</span>
                </button>
              ))
            ) : (
              <div className="hierarchy-empty">
                <strong>No {activeGroup.title.toLowerCase()}</strong>
                <span>This object has no live resources in this relationship.</span>
              </div>
            )}
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
