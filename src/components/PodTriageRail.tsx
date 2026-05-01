import { memo, useCallback, useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, Container, FileText, ImageOff, RotateCw, ServerCrash, Timer } from "lucide-react";
import type { HealthState, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type PodTriageBucket = {
  id: "crash" | "image" | "pending" | "restarts";
  count: number;
  label: string;
  tone: Exclude<HealthState, "healthy" | "syncing">;
};

export function PodTriageRail({
  onOpenLogs,
  onSelect,
  pods,
}: {
  onOpenLogs: (id: string) => void;
  onSelect: (id: string) => void;
  pods: ResourceRow[];
}) {
  const [activeBucketId, setActiveBucketId] = useState<PodTriageBucket["id"] | null>(null);
  const buckets = useMemo(() => podTriageBuckets(pods), [pods]);
  const activeBucket = buckets.find((bucket) => bucket.id === activeBucketId && bucket.count > 0) ?? null;
  const activeBucketFilter = activeBucket?.id ?? null;
  const filteredPods = useMemo(
    () => activeBucketFilter ? pods.filter((pod) => podTriageBucket(pod) === activeBucketFilter) : pods,
    [activeBucketFilter, pods],
  );

  if (!pods.length) {
    return null;
  }

  const visiblePods = filteredPods.slice(0, 4);
  const countLabel = `${visiblePods.length === filteredPods.length ? filteredPods.length : `${visiblePods.length}/${filteredPods.length}`} ${
    activeBucket?.label.toLowerCase() ?? "active"
  }`;

  return (
    <section className="pod-triage-rail" aria-label="Pod triage" data-testid="pod-triage-rail">
      <header>
        <span>
          <Container size={15} />
          Pod triage
        </span>
        <strong>{countLabel}</strong>
      </header>
      <div className="pod-triage-content">
        <div className="pod-triage-buckets" aria-label="Pod failure classes">
          {buckets.map((bucket) => (
            <TriageBucket
              active={bucket.id === activeBucket?.id}
              bucket={bucket}
              key={bucket.id}
              onSelect={() => setActiveBucketId((current) => current === bucket.id ? null : bucket.id)}
            />
          ))}
        </div>
        <div className="pod-triage-items">
          {visiblePods.map((pod) => (
            <PodTriageButton key={pod.id} pod={pod} onOpenLogs={onOpenLogs} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TriageBucket({
  active,
  bucket,
  onSelect,
}: {
  active: boolean;
  bucket: PodTriageBucket;
  onSelect: () => void;
}) {
  const Icon = bucketIcon(bucket.id);

  return (
    <button
      aria-pressed={active}
      className={active ? `pod-triage-bucket ${bucket.tone} active` : `pod-triage-bucket ${bucket.tone}`}
      disabled={bucket.count === 0}
      style={{ "--value": bucket.count ? "100%" : "0%" } as CSSProperties}
      type="button"
      onClick={onSelect}
    >
      <Icon size={14} />
      <span>{bucket.label}</span>
      <strong>{bucket.count}</strong>
    </button>
  );
}

const PodTriageButton = memo(function PodTriageButton({
  onOpenLogs,
  onSelect,
  pod,
}: {
  onOpenLogs: (id: string) => void;
  onSelect: (id: string) => void;
  pod: ResourceRow;
}) {
  const handleSelect = useCallback(() => onSelect(pod.id), [onSelect, pod.id]);
  const handleOpenLogs = useCallback(() => onOpenLogs(pod.id), [onOpenLogs, pod.id]);
  const triageTone = pod.status === "healthy" && pod.restarts > 0 ? "warning" : pod.status;
  const diagnostic = pod.diagnostic || (pod.restarts > 0 ? `${pod.restarts} restarts` : pod.status);

  return (
    <div className={`pod-triage-item ${triageTone}`}>
      <button className="pod-triage-open" type="button" onClick={handleSelect}>
        <StatusDot state={triageTone} />
        <span>
          <strong title={pod.name}>{pod.name}</strong>
          <small title={pod.namespace}>{pod.namespace}</small>
        </span>
        <em title={diagnostic}>{diagnostic}</em>
        <small>{pod.restarts}r</small>
      </button>
      <button
        aria-label={`Open logs for ${pod.name}`}
        className="pod-triage-log"
        title="Open logs"
        type="button"
        onClick={handleOpenLogs}
      >
        <FileText size={13} />
      </button>
    </div>
  );
});

export function shouldTriagePod(resource: ResourceRow) {
  return resource.kind === "Pod" && (resource.status !== "healthy" || resource.restarts > 0 || Boolean(resource.diagnostic.trim()));
}

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
