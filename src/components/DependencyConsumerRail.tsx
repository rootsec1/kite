import { useMemo } from "react";
import { FileText, Link2 } from "lucide-react";
import { ownsPod, referencesResource, workloadKinds } from "../lib/resourceRelationships";
import type { HealthState, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type DependencyConsumerRailProps = {
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
};

const dependencyConsumerKinds = new Set(["ConfigMap", "Secret", "PersistentVolumeClaim", "ServiceAccount"]);

export function DependencyConsumerRail({ onOpenResource, resource, resources }: DependencyConsumerRailProps) {
  const pods = useMemo(() => dependencyConsumersFor(resource, resources).sort(compareConsumerPods), [resource, resources]);
  const owners = useMemo(() => ownersForPods(pods, resources), [pods, resources]);

  if (!dependencyConsumerKinds.has(resource.kind)) {
    return null;
  }

  const readyPods = pods.filter((pod) => pod.status === "healthy").length;
  const visiblePods = pods.slice(0, 5);
  const tone = consumerTone(resource, pods);

  return (
    <section className={`workload-pod-rail service-backend-rail dependency-consumer-rail ${tone}`} aria-label="Dependency consumers">
      <header>
        <span>
          <Link2 size={15} />
          Consumers
        </span>
        <strong>{readyPods}/{pods.length || 0} pods</strong>
        <small>{owners.length ? `${owners.length} owners` : resource.diagnostic || resource.namespace}</small>
      </header>
      <div>
        {visiblePods.length ? (
          visiblePods.map((pod) => (
            <ConsumerPodTile key={pod.id} onOpenResource={onOpenResource} pod={pod} />
          ))
        ) : (
          <div className="service-backend-empty">
            <span>No consuming pods</span>
            <strong>No live pod references this {resource.kind}.</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function ConsumerPodTile({
  onOpenResource,
  pod,
}: {
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  pod: ResourceRow;
}) {
  return (
    <article className={`workload-pod-tile ${pod.status}`}>
      <button className="workload-pod-open" type="button" onClick={() => onOpenResource(pod.id)}>
        <StatusDot state={pod.status} />
        <strong title={pod.name}>{pod.name}</strong>
        <em title={pod.diagnostic || pod.status}>{pod.diagnostic || pod.status}</em>
        <small title={pod.owner || pod.namespace}>{pod.owner || pod.namespace}</small>
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

function dependencyConsumersFor(resource: ResourceRow, resources: ResourceRow[]) {
  if (!dependencyConsumerKinds.has(resource.kind)) {
    return [];
  }

  return resources.filter((item) => item.kind === "Pod" && referencesResource(item, resource));
}

function ownersForPods(pods: ResourceRow[], resources: ResourceRow[]) {
  return resources.filter((item) => workloadKinds.has(item.kind) && pods.some((pod) => ownsPod(item, pod)));
}

function consumerTone(resource: ResourceRow, pods: ResourceRow[]): HealthState {
  if (resource.status !== "healthy") {
    return resource.status;
  }
  if (!pods.length) {
    return "syncing";
  }
  if (pods.some((pod) => pod.status === "critical")) {
    return "critical";
  }
  if (pods.some((pod) => pod.status === "warning")) {
    return "warning";
  }
  if (pods.every((pod) => pod.status === "syncing")) {
    return "syncing";
  }
  return "healthy";
}

function compareConsumerPods(left: ResourceRow, right: ResourceRow) {
  return consumerRank(left) - consumerRank(right) ||
    right.restarts - left.restarts ||
    left.namespace.localeCompare(right.namespace) ||
    left.name.localeCompare(right.name);
}

function consumerRank(resource: ResourceRow) {
  switch (resource.status) {
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
