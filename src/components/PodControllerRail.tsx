import { useMemo } from "react";
import { FileText, GitCommitHorizontal } from "lucide-react";
import { ownsPod } from "../lib/resourceRelationships";
import type { ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type PodControllerRailProps = {
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  pod: ResourceRow;
  resources: ResourceRow[];
};

const parentOwnerKinds = new Set(["ReplicaSet", "Job"]);

export function PodControllerRail({ onOpenResource, pod, resources }: PodControllerRailProps) {
  const ownerRef = useMemo(() => resourceOwnerRef(pod), [pod]);
  const owner = useMemo(
    () => ownerRef
      ? resources.find((item) => item.kind === ownerRef.kind && item.namespace === pod.namespace && item.name === ownerRef.name)
      : undefined,
    [ownerRef, pod.namespace, resources],
  );
  const parentRef = useMemo(() => owner && parentOwnerKinds.has(owner.kind) ? resourceOwnerRef(owner) : null, [owner]);
  const parent = useMemo(
    () => parentRef
      ? resources.find((item) => item.kind === parentRef.kind && item.namespace === pod.namespace && item.name === parentRef.name)
      : undefined,
    [parentRef, pod.namespace, resources],
  );
  const siblingPods = useMemo(
    () => owner
      ? resources
        .filter((item) => item.kind === "Pod" && item.id !== pod.id && item.namespace === pod.namespace && ownsPod(owner, item))
        .sort(compareRuntimePods)
      : [],
    [owner, pod.id, pod.namespace, resources],
  );

  if (!ownerRef) {
    return null;
  }

  const visibleSiblings = siblingPods.slice(0, parent ? 2 : 3);
  const tone = parent?.status ?? owner?.status ?? "warning";
  const controllerLabel = parent ? `${ownerRef.kind} -> ${parent.kind}` : ownerRef.kind;

  return (
    <section className={`workload-pod-rail service-backend-rail owner-rail ${tone}`} aria-label="Pod controller">
      <header>
        <span>
          <GitCommitHorizontal size={15} />
          Controller
        </span>
        <strong>{controllerLabel}</strong>
        <small>{siblingPods.length ? `${siblingPods.length} siblings` : pod.owner}</small>
      </header>
      <div>
        {owner ? (
          <LinkedResourceTile meta="owner" resource={owner} onOpenResource={onOpenResource} />
        ) : (
          <div className="service-backend-empty">
            <span>Owner missing</span>
            <strong>{pod.owner} is not in this snapshot.</strong>
          </div>
        )}
        {parent ? <LinkedResourceTile meta="parent" resource={parent} onOpenResource={onOpenResource} /> : null}
        {visibleSiblings.map((sibling) => (
          <LinkedPodTile key={sibling.id} meta={sibling.nodeName || sibling.namespace} pod={sibling} onOpenResource={onOpenResource} />
        ))}
      </div>
    </section>
  );
}

function resourceOwnerRef(resource: ResourceRow) {
  const [kind, name] = resource.owner.split("/", 2);
  if (!kind || !name) {
    return null;
  }

  return { kind, name };
}

function LinkedResourceTile({
  meta,
  onOpenResource,
  resource,
}: {
  meta: string;
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  resource: ResourceRow;
}) {
  return (
    <button className={resource.status} type="button" onClick={() => onOpenResource(resource.id)}>
      <StatusDot state={resource.status} />
      <strong title={resource.name}>{resource.name}</strong>
      <em title={resource.diagnostic || resource.status}>{resource.diagnostic || resource.status}</em>
      <small title={resource.kind}>{resource.kind}</small>
      <small>{meta}</small>
    </button>
  );
}

function LinkedPodTile({
  meta,
  onOpenResource,
  pod,
}: {
  meta: string;
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  pod: ResourceRow;
}) {
  return (
    <article className={`workload-pod-tile ${pod.status}`}>
      <button className="workload-pod-open" type="button" onClick={() => onOpenResource(pod.id)}>
        <StatusDot state={pod.status} />
        <strong title={pod.name}>{pod.name}</strong>
        <em title={pod.diagnostic || pod.status}>{pod.diagnostic || pod.status}</em>
        <small title={meta}>{meta}</small>
        <small>{pod.restarts}r</small>
      </button>
      <button
        aria-label={`Open logs for ${pod.name}`}
        className="workload-pod-log"
        title="Open logs"
        type="button"
        onClick={() => onOpenResource(pod.id, "logs")}
      >
        <FileText size={13} />
      </button>
    </article>
  );
}

function compareRuntimePods(left: ResourceRow, right: ResourceRow) {
  return podRuntimeRank(left) - podRuntimeRank(right) ||
    right.restarts - left.restarts ||
    left.name.localeCompare(right.name);
}

function podRuntimeRank(pod: ResourceRow) {
  switch (pod.status) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "syncing":
      return 2;
    case "healthy":
      return 3;
  }
}
