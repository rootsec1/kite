import { GitFork, KeyRound, Route, Shield, SlidersHorizontal, TimerReset } from "lucide-react";
import type { PodDetails } from "../types/kube";

type PlacementItem = {
  icon: typeof Route;
  label: string;
  value: string;
  meta: string;
};

export function PodPlacementStrip({ pod }: { pod?: PodDetails }) {
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
        {items.map(({ icon: Icon, label, meta, value }) => (
          <article key={label}>
            <Icon size={15} />
            <span>{label}</span>
            <strong title={value}>{value}</strong>
            <small title={meta}>{meta}</small>
          </article>
        ))}
      </div>
    </section>
  );
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
          label: "Priority",
          value: scheduling.priorityClassName,
          meta: "preemption class",
        }
      : null,
    scheduling.runtimeClassName
      ? {
          icon: SlidersHorizontal,
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
