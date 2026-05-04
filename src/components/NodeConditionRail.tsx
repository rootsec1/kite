import { Cpu, Database, HardDrive, Server, ShieldAlert, Workflow } from "lucide-react";
import type { HealthState, NodeCondition, NodeDetails, ResourceDetails, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

export function NodeConditionRail({
  details,
  detailsLoading,
  resource,
}: {
  details: ResourceDetails;
  detailsLoading: boolean;
  resource: ResourceRow;
}) {
  if (resource.kind !== "Node") {
    return null;
  }

  const node = details.node;
  const conditions = prioritizedNodeConditions(node?.conditions ?? []);
  const visibleConditions = conditions.slice(0, 5);
  const tone = nodeHealthTone(node, detailsLoading);
  const pressureCount = conditions.filter((condition) => conditionTone(condition) !== "healthy").length;

  return (
    <section className={`node-health-rail ${tone}`} aria-label="Node health">
      <header>
        <span>
          <Server size={15} />
          Node health
        </span>
        <strong>{nodeHealthReadout(node, detailsLoading)}</strong>
        <small>{nodeHeaderMeta(node, pressureCount)}</small>
      </header>
      <div className="node-condition-grid">
        {visibleConditions.length ? (
          visibleConditions.map((condition) => (
            <article className={conditionTone(condition)} key={condition.type}>
              <StatusDot state={conditionTone(condition)} />
              <span>{condition.type}</span>
              <strong>{condition.status}</strong>
              <small title={condition.message || condition.reason}>{condition.reason || condition.message || "steady"}</small>
            </article>
          ))
        ) : (
          <article className="syncing">
            <StatusDot state="syncing" />
            <span>Conditions</span>
            <strong>{detailsLoading ? "Syncing" : "Unknown"}</strong>
            <small>{detailsLoading ? "reading node" : "inspect YAML"}</small>
          </article>
        )}
      </div>
      <div className="node-fact-grid" aria-label="Node runtime facts">
        <NodeFact icon={Cpu} label="CPU" value={capacityPair(node, "cpu")} />
        <NodeFact icon={Database} label="Memory" value={capacityPair(node, "memory")} />
        <NodeFact icon={Workflow} label="Pods" value={capacityPair(node, "pods")} />
        <NodeFact icon={ShieldAlert} label="Taints" value={nodeTaintReadout(node)} />
        <NodeFact icon={HardDrive} label="Runtime" value={compactRuntime(node?.containerRuntimeVersion)} />
        <NodeFact icon={Server} label="Kubelet" value={node?.kubeletVersion || "unknown"} />
      </div>
    </section>
  );
}

const conditionPriority = new Map([
  ["Ready", 0],
  ["MemoryPressure", 1],
  ["DiskPressure", 2],
  ["PIDPressure", 3],
  ["NetworkUnavailable", 4],
]);

function prioritizedNodeConditions(conditions: NodeCondition[]) {
  return [...conditions].sort((left, right) =>
    (conditionPriority.get(left.type) ?? 20) - (conditionPriority.get(right.type) ?? 20) ||
    left.type.localeCompare(right.type)
  );
}

function nodeHealthTone(node: NodeDetails | undefined, detailsLoading: boolean): HealthState {
  if (!node) {
    return detailsLoading ? "syncing" : "warning";
  }
  if (node.conditions.some((condition) => conditionTone(condition) === "critical")) {
    return "critical";
  }
  if (node.unschedulable || node.conditions.some((condition) => conditionTone(condition) === "warning")) {
    return "warning";
  }
  if (!node.conditions.length) {
    return "syncing";
  }
  return "healthy";
}

function conditionTone(condition: NodeCondition): HealthState {
  if (condition.status === "Unknown") {
    return "syncing";
  }
  if (condition.type === "Ready") {
    return condition.status === "True" ? "healthy" : "critical";
  }
  if (["MemoryPressure", "DiskPressure", "PIDPressure"].includes(condition.type)) {
    return condition.status === "True" ? "critical" : "healthy";
  }
  if (condition.type === "NetworkUnavailable") {
    return condition.status === "True" ? "warning" : "healthy";
  }
  return condition.status === "True" ? "healthy" : "warning";
}

function nodeHealthReadout(node: NodeDetails | undefined, detailsLoading: boolean) {
  if (!node) {
    return detailsLoading ? "Syncing" : "No status";
  }
  if (node.unschedulable) {
    return "Unschedulable";
  }
  const ready = node.conditions.find((condition) => condition.type === "Ready");
  if (!ready) {
    return "Unknown";
  }
  return ready.status === "True" ? "Ready" : "NotReady";
}

function nodeHeaderMeta(node: NodeDetails | undefined, pressureCount: number) {
  if (!node) {
    return "node status";
  }
  if (pressureCount) {
    return `${pressureCount} signals`;
  }
  if (node.taints.length) {
    return `${node.taints.length} taints`;
  }
  return node.kubeletVersion || node.operatingSystem || "steady";
}

function capacityPair(node: NodeDetails | undefined, key: string) {
  const allocatable = node?.allocatable[key];
  const capacity = node?.capacity[key];
  if (allocatable && capacity && allocatable !== capacity) {
    return `${allocatable}/${capacity}`;
  }
  return allocatable || capacity || "unknown";
}

function nodeTaintReadout(node: NodeDetails | undefined) {
  if (!node) {
    return "unknown";
  }
  if (!node.taints.length) {
    return node.unschedulable ? "unschedulable" : "none";
  }
  return node.taints.slice(0, 2).join(", ") + (node.taints.length > 2 ? ` +${node.taints.length - 2}` : "");
}

function compactRuntime(runtime?: string) {
  if (!runtime) {
    return "unknown";
  }
  return runtime.replace(/^containerd:\/\//, "containerd ").replace(/^docker:\/\//, "docker ");
}

function NodeFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <span>
      <Icon size={14} />
      <small>{label}</small>
      <strong title={value}>{value}</strong>
    </span>
  );
}
