import { useMemo } from "react";
import { GalleryVerticalEnd } from "lucide-react";
import type { HealthState, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type HelmReleaseRailProps = {
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
};

export function HelmReleaseRail({ onOpenResource, resource, resources }: HelmReleaseRailProps) {
  const release = useMemo(() => helmReleaseForResource(resource, resources), [resource, resources]);
  const members = useMemo(
    () => release ? helmReleaseMembers(release, resources).sort(compareReleaseMembers) : [],
    [release, resources],
  );

  if (!release) {
    return null;
  }

  const visibleMembers = members.filter((item) => item.id !== resource.id).slice(0, 4);
  const unhealthyCount = members.filter((item) => item.status !== "healthy").length;
  const tone = helmReleaseTone(release, members);
  const releaseSelected = resource.kind === "HelmRelease";
  const headerMeta = unhealthyCount
    ? `${unhealthyCount} review`
    : releaseSelected
      ? `${members.length} objects`
      : release.owner || release.image || release.namespace;

  return (
    <section className={`workload-pod-rail service-backend-rail helm-release-rail ${tone}`} aria-label="Helm release topology">
      <header>
        <span>
          <GalleryVerticalEnd size={15} />
          Release
        </span>
        <strong title={release.name}>{release.name}</strong>
        <small title={release.owner || release.image || headerMeta}>{headerMeta}</small>
      </header>
      <div>
        {!releaseSelected ? (
          <button className={release.status} type="button" onClick={() => onOpenResource(release.id)}>
            <StatusDot state={release.status} />
            <strong title={release.name}>{release.name}</strong>
            <em title={release.owner || release.image || release.status}>{release.owner || release.image || release.status}</em>
            <small title={release.namespace}>{release.namespace}</small>
            <small>{release.age}</small>
          </button>
        ) : null}
        {visibleMembers.map((member) => (
          <button
            className={member.status}
            key={member.id}
            type="button"
            onClick={() => onOpenResource(member.id, member.kind === "Pod" ? "logs" : null)}
          >
            <StatusDot state={member.status} />
            <strong title={member.name}>{member.name}</strong>
            <em title={member.diagnostic || member.kind}>{member.diagnostic || member.kind}</em>
            <small title={member.namespace}>{member.kind}</small>
            <small>{member.restarts ? `${member.restarts}r` : member.age}</small>
          </button>
        ))}
        {!visibleMembers.length && releaseSelected ? (
          <div className="service-backend-empty">
            <span>No linked objects</span>
            <strong>No live resources carry this Helm release label.</strong>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function helmReleaseForResource(resource: ResourceRow, resources: ResourceRow[]) {
  if (resource.kind === "HelmRelease") {
    return resource;
  }

  if (!hasHelmReleaseSignal(resource)) {
    return null;
  }

  return resources.find(
    (item) => item.kind === "HelmRelease" && item.namespace === resource.namespace && helmReleaseMatchesResource(item, resource),
  ) ?? null;
}

export function helmReleaseMembers(release: ResourceRow, resources: ResourceRow[]) {
  if (release.kind !== "HelmRelease") {
    return [];
  }

  return resources.filter((item) =>
    item.id !== release.id &&
    item.namespace === release.namespace &&
    helmReleaseMatchesResource(release, item)
  );
}

export function compareReleaseMembers(left: ResourceRow, right: ResourceRow) {
  return statusRank(left.status) - statusRank(right.status) ||
    releaseKindRank(left.kind) - releaseKindRank(right.kind) ||
    left.name.localeCompare(right.name);
}

function helmReleaseMatchesResource(release: ResourceRow, resource: ResourceRow) {
  const instance = helmReleaseInstance(resource);
  const chart = resource.labels["helm.sh/chart"];

  if (instance && instanceMatchesRelease(instance, release.name) && hasHelmReleaseSignal(resource)) {
    return true;
  }

  return Boolean(chart && release.owner && normalizeHelmChart(chart) === normalizeHelmChart(release.owner));
}

function hasHelmReleaseSignal(resource: ResourceRow) {
  return resource.labels["app.kubernetes.io/managed-by"]?.toLowerCase() === "helm" ||
    Boolean(resource.labels["helm.sh/chart"] || resource.labels["helm.sh/release"]);
}

function helmReleaseInstance(resource: ResourceRow) {
  const instance = resource.labels["app.kubernetes.io/instance"];
  return instance || resource.labels["helm.sh/release"] || "";
}

function instanceMatchesRelease(instance: string, releaseName: string) {
  return instance === releaseName || instance.startsWith(`${releaseName}-`);
}

function normalizeHelmChart(value: string) {
  return value.replace(/\+/g, "_").toLowerCase();
}

function helmReleaseTone(release: ResourceRow, members: ResourceRow[]): HealthState {
  if (release.status !== "healthy") {
    return release.status;
  }
  if (members.some((member) => member.status === "critical")) {
    return "critical";
  }
  if (members.some((member) => member.status === "warning")) {
    return "warning";
  }
  if (members.length && members.every((member) => member.status === "syncing")) {
    return "syncing";
  }
  return "healthy";
}

function statusRank(status: HealthState) {
  switch (status) {
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

function releaseKindRank(kind: string) {
  switch (kind) {
    case "Pod":
      return 0;
    case "Deployment":
    case "StatefulSet":
    case "DaemonSet":
    case "Job":
    case "CronJob":
    case "ReplicaSet":
      return 1;
    case "Service":
    case "Ingress":
    case "HTTPRoute":
    case "Gateway":
      return 2;
    default:
      return 3;
  }
}
