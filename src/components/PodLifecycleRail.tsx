import { Activity, History, RotateCw } from "lucide-react";
import { containerCurrentState, containerLastState, containerLifecycleTone, currentStateTime, lastStateTime } from "../lib/podLifecycle";
import type { ContainerDetails, ResourceDetails } from "../types/kube";
import { StatusDot } from "./status";

type LifecycleItem = {
  container: ContainerDetails;
  current: string;
  currentTime: string;
  last: string;
  lastTime: string;
  tone: ReturnType<typeof containerLifecycleTone>;
};

export function PodLifecycleRail({ details }: { details: ResourceDetails }) {
  const containers = details.pod?.containers ?? [];
  const items = containers.map(containerLifecycleItem);

  if (!shouldShowLifecycleRail(items)) {
    return null;
  }

  const readyCount = containers.filter((container) => container.ready).length;
  const restartCount = containers.reduce((sum, container) => sum + container.restartCount, 0);

  return (
    <section className="pod-lifecycle-rail" aria-label="Container lifecycle">
      <header>
        <span>Lifecycle</span>
        <strong>{readyCount}/{containers.length} ready</strong>
        <small>{restartCount} restarts</small>
      </header>
      <div>
        {items.map((item) => (
          <article className={item.tone} key={item.container.name}>
            <div>
              <StatusDot state={item.tone} />
              <strong title={item.container.name}>{item.container.name}</strong>
              <small>{item.container.role}</small>
            </div>
            <LifecycleFact icon={Activity} label="Now" value={item.current || "pending"} meta={item.currentTime || "live"} />
            {item.last ? <LifecycleFact icon={History} label="Last" value={item.last} meta={item.lastTime || "previous"} /> : null}
            <LifecycleFact icon={RotateCw} label="Restarts" value={String(item.container.restartCount)} meta={item.container.ready ? "ready" : "not ready"} />
          </article>
        ))}
      </div>
    </section>
  );
}

function containerLifecycleItem(container: ContainerDetails): LifecycleItem {
  return {
    container,
    current: containerCurrentState(container),
    currentTime: currentStateTime(container),
    last: containerLastState(container),
    lastTime: lastStateTime(container),
    tone: containerLifecycleTone(container),
  };
}

function shouldShowLifecycleRail(items: LifecycleItem[]) {
  return items.length > 1 || items.some((item) => item.tone !== "healthy" || item.container.restartCount > 0 || item.last);
}

function LifecycleFact({
  icon: Icon,
  label,
  meta,
  value,
}: {
  icon: typeof Activity;
  label: string;
  meta: string;
  value: string;
}) {
  return (
    <span className="pod-lifecycle-fact">
      <Icon size={13} />
      <small>{label}</small>
      <strong title={value}>{value}</strong>
      <em title={meta}>{meta}</em>
    </span>
  );
}
