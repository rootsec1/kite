import { Gauge } from "lucide-react";
import type { HealthState, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type NamespaceConstraintRailProps = {
  onOpenResource: (id: string) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
};

const namespaceConstraintKinds = new Set(["ResourceQuota", "LimitRange"]);

export function NamespaceConstraintRail({ onOpenResource, resource, resources }: NamespaceConstraintRailProps) {
  if (resource.kind !== "Namespace") {
    return null;
  }

  const constraints = namespaceConstraints(resource.name, resources);
  const tone = constraintTone(constraints);
  const quotas = constraints.filter((item) => item.kind === "ResourceQuota").length;
  const limitRanges = constraints.filter((item) => item.kind === "LimitRange").length;

  return (
    <section className={`workload-pod-rail service-backend-rail namespace-constraint-rail ${tone}`} aria-label="Namespace constraints">
      <header>
        <span>
          <Gauge size={15} />
          Constraints
        </span>
        <strong>{constraintSummary(quotas, limitRanges)}</strong>
        <small>{constraintMeta(constraints)}</small>
      </header>
      <div>
        {constraints.length ? (
          constraints.slice(0, 5).map((constraint) => (
            <button className={constraint.status} key={constraint.id} type="button" onClick={() => onOpenResource(constraint.id)}>
              <StatusDot state={constraint.status} />
              <strong title={constraint.name}>{constraint.name}</strong>
              <em title={constraint.diagnostic || constraint.image}>{constraint.diagnostic || constraint.image || "active"}</em>
              <small>{constraintKindLabel(constraint.kind)}</small>
              <small>{constraint.owner || constraint.age}</small>
            </button>
          ))
        ) : (
          <div className="service-backend-empty">
            <span>No constraints</span>
            <strong>No ResourceQuota or LimitRange found in this namespace.</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function namespaceConstraints(namespace: string, resources: ResourceRow[]) {
  return resources
    .filter((item) => item.namespace === namespace && namespaceConstraintKinds.has(item.kind))
    .sort(compareConstraints);
}

function constraintTone(constraints: ResourceRow[]): HealthState {
  if (!constraints.length) {
    return "syncing";
  }
  if (constraints.some((item) => item.status === "critical")) {
    return "critical";
  }
  if (constraints.some((item) => item.status === "warning")) {
    return "warning";
  }
  return "healthy";
}

function constraintSummary(quotas: number, limitRanges: number) {
  return `${quotas} ${pluralize(quotas, "quota")} / ${limitRanges} ${pluralize(limitRanges, "limit")}`;
}

function constraintMeta(constraints: ResourceRow[]) {
  const warnings = constraints.filter((item) => item.status !== "healthy").length;
  return warnings ? `${warnings} ${pluralize(warnings, "warning")}` : constraints.length ? "enforced" : "unbounded";
}

function compareConstraints(left: ResourceRow, right: ResourceRow) {
  return statusRank(left.status) - statusRank(right.status) ||
    kindRank(left.kind) - kindRank(right.kind) ||
    left.name.localeCompare(right.name);
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

function kindRank(kind: string) {
  return kind === "ResourceQuota" ? 0 : 1;
}

function constraintKindLabel(kind: string) {
  return kind === "ResourceQuota" ? "Quota" : "Limit";
}

function pluralize(count: number, singular: string) {
  return count === 1 ? singular : `${singular}s`;
}
