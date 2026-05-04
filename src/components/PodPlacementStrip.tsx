import { GitFork, KeyRound, Route, Shield, SlidersHorizontal, TimerReset } from "lucide-react";
import type { PodDetails, ResourceRow } from "../types/kube";

type PlacementItem = {
  icon: typeof Route;
  kind?: string;
  label: string;
  value: string;
  meta: string;
};

export function PodPlacementStrip({
  allResources,
  onOpenResource,
  pod,
}: {
  allResources: ResourceRow[];
  onOpenResource: (id: string) => void;
  pod?: PodDetails;
}) {
  if (!pod?.scheduling) {
    return null;
  }

  const items = placementItems(pod);
  if (!items.length) {
    return null;
  }

  return (
    <section className="pod-placement-strip" aria-label="Pod placement constraints">
      <header>
        <span>Placement</span>
        <strong>{pod.nodeName || "unscheduled"}</strong>
      </header>
      <div>
        {items.map((item) => (
          <PlacementCard
            item={item}
            key={item.label}
            resource={placementResource(item, allResources)}
            onOpenResource={onOpenResource}
          />
        ))}
      </div>
    </section>
  );
}

function PlacementCard({
  item,
  onOpenResource,
  resource,
}: {
  item: PlacementItem;
  onOpenResource: (id: string) => void;
  resource?: ResourceRow;
}) {
  const Icon = item.icon;
  const content = (
    <>
      <Icon size={15} />
      <span>{item.label}</span>
      <strong title={item.value}>{item.value}</strong>
      <small title={resource?.diagnostic || item.meta}>{resource?.diagnostic || item.meta}</small>
    </>
  );

  if (resource) {
    return (
      <button title={`Open ${resource.kind} ${resource.name}`} type="button" onClick={() => onOpenResource(resource.id)}>
        {content}
      </button>
    );
  }

  return <article>{content}</article>;
}

function placementResource(item: PlacementItem, resources: ResourceRow[]) {
  if (!item.kind || !item.value) {
    return undefined;
  }
  return resources.find((resource) => resource.kind === item.kind && resource.namespace === "cluster" && resource.name === item.value);
}

function placementItems(pod: PodDetails): PlacementItem[] {
  const { scheduling } = pod;
  const nodeSelectors = Object.entries(scheduling.nodeSelector).map(([key, value]) => `${key}=${value}`);
  const hasPlacementSignal = !pod.nodeName ||
    nodeSelectors.length > 0 ||
    scheduling.tolerations.length > 0 ||
    scheduling.affinity.length > 0 ||
    scheduling.schedulingGates.length > 0 ||
    Boolean(scheduling.priorityClassName || scheduling.runtimeClassName);

  if (!hasPlacementSignal) {
    return [];
  }

  return [
    {
      icon: Route,
      label: "Scheduler",
      value: scheduling.schedulerName || "default-scheduler",
      meta: pod.nodeName ? "bound node" : "waiting for node",
    },
    {
      icon: Shield,
      label: "Service account",
      value: scheduling.serviceAccountName || "default",
      meta: "pod identity",
    },
    scheduling.priorityClassName
      ? {
          icon: TimerReset,
          kind: "PriorityClass",
          label: "Priority",
          value: scheduling.priorityClassName,
          meta: "preemption class",
        }
      : null,
    scheduling.runtimeClassName
      ? {
          icon: SlidersHorizontal,
          kind: "RuntimeClass",
          label: "Runtime",
          value: scheduling.runtimeClassName,
          meta: "runtime class",
        }
      : null,
    nodeSelectors.length
      ? {
          icon: KeyRound,
          label: "Node selector",
          value: nodeSelectors.join(", "),
          meta: `${nodeSelectors.length} match`,
        }
      : null,
    scheduling.tolerations.length
      ? {
          icon: SlidersHorizontal,
          label: "Tolerations",
          value: scheduling.tolerations.join(", "),
          meta: `${scheduling.tolerations.length} rule`,
        }
      : null,
    scheduling.affinity.length
      ? {
          icon: GitFork,
          label: "Affinity",
          value: scheduling.affinity.join(", "),
          meta: `${scheduling.affinity.length} policy`,
        }
      : null,
    scheduling.schedulingGates.length
      ? {
          icon: KeyRound,
          label: "Gates",
          value: scheduling.schedulingGates.join(", "),
          meta: `${scheduling.schedulingGates.length} hold`,
        }
      : null,
  ].filter((item): item is PlacementItem => Boolean(item)).slice(0, 6);
}
