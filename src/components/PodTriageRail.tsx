import { memo, useCallback, useMemo, type CSSProperties } from "react";
import { AlertTriangle, Container, ImageOff, RotateCw, ServerCrash, Timer } from "lucide-react";
import type { HealthState, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type PodTriageBucket = {
  id: "crash" | "image" | "pending" | "restarts";
  count: number;
  label: string;
  tone: Exclude<HealthState, "healthy" | "syncing">;
};

export function PodTriageRail({ pods, onSelect }: { pods: ResourceRow[]; onSelect: (id: string) => void }) {
  const buckets = useMemo(() => podTriageBuckets(pods), [pods]);

  if (!pods.length) {
    return null;
  }

  const visiblePods = pods.slice(0, 4);

  return (
    <section className="pod-triage-rail" aria-label="Pod triage" data-testid="pod-triage-rail">
      <header>
        <span>
          <Container size={15} />
          Pod triage
        </span>
        <strong>{visiblePods.length === pods.length ? pods.length : `${visiblePods.length}/${pods.length}`} active</strong>
      </header>
      <div className="pod-triage-content">
        <div className="pod-triage-buckets" aria-label="Pod failure classes">
          {buckets.map((bucket) => (
            <TriageBucket bucket={bucket} key={bucket.id} />
          ))}
        </div>
        <div className="pod-triage-items">
          {visiblePods.map((pod) => (
            <PodTriageButton key={pod.id} pod={pod} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TriageBucket({ bucket }: { bucket: PodTriageBucket }) {
  const Icon = bucketIcon(bucket.id);

  return (
    <article className={`pod-triage-bucket ${bucket.tone}`} style={{ "--value": bucket.count ? "100%" : "0%" } as CSSProperties}>
      <Icon size={14} />
      <span>{bucket.label}</span>
      <strong>{bucket.count}</strong>
    </article>
  );
}

const PodTriageButton = memo(function PodTriageButton({
  onSelect,
  pod,
}: {
  onSelect: (id: string) => void;
  pod: ResourceRow;
}) {
  const handleSelect = useCallback(() => onSelect(pod.id), [onSelect, pod.id]);

  return (
    <button className={`pod-triage-item ${pod.status}`} type="button" onClick={handleSelect}>
      <StatusDot state={pod.status} />
      <span>
        <strong title={pod.name}>{pod.name}</strong>
        <small title={pod.namespace}>{pod.namespace}</small>
      </span>
      <em title={pod.diagnostic || pod.status}>{pod.diagnostic || pod.status}</em>
      <small>{pod.restarts}r</small>
    </button>
  );
});

function podTriageBuckets(pods: ResourceRow[]): PodTriageBucket[] {
  const counts = new Map<PodTriageBucket["id"], number>([
    ["crash", 0],
    ["image", 0],
    ["pending", 0],
    ["restarts", 0],
  ]);

  for (const pod of pods) {
    const bucket = podTriageBucket(pod);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return [
    { id: "crash", label: "Crash", count: counts.get("crash") ?? 0, tone: "critical" },
    { id: "image", label: "Image", count: counts.get("image") ?? 0, tone: "critical" },
    { id: "pending", label: "Pending", count: counts.get("pending") ?? 0, tone: "warning" },
    { id: "restarts", label: "Restarts", count: counts.get("restarts") ?? 0, tone: "warning" },
  ];
}

function podTriageBucket(pod: ResourceRow): PodTriageBucket["id"] {
  const diagnostic = pod.diagnostic.toLowerCase();

  if (/(crashloop|oomkilled|runcontainer|terminated|exit)/.test(diagnostic)) {
    return "crash";
  }
  if (/(imagepull|errimage|invalidimage)/.test(diagnostic)) {
    return "image";
  }
  if (/(pending|unschedulable|scheduling|not ready|node)/.test(diagnostic) || pod.status === "syncing") {
    return "pending";
  }
  return pod.restarts > 0 ? "restarts" : "pending";
}

function bucketIcon(id: PodTriageBucket["id"]) {
  switch (id) {
    case "crash":
      return ServerCrash;
    case "image":
      return ImageOff;
    case "pending":
      return Timer;
    case "restarts":
      return RotateCw;
    default:
      return AlertTriangle;
  }
}
