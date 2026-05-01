import type { ResourceRow } from "../types/kube";

export const workloadKinds = new Set(["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "ReplicaSet"]);

export function ownsPod(owner: ResourceRow, pod: ResourceRow) {
  if (pod.owner.includes(`/${owner.name}`)) {
    return true;
  }
  if (owner.kind === "Deployment" && pod.owner.startsWith(`ReplicaSet/${owner.name}-`)) {
    return true;
  }
  return matchesSelector(pod, owner.selector) || matchesSelector(pod, owner.labels);
}

export function matchesSelector(resource: ResourceRow, selector: Record<string, string>) {
  const entries = Object.entries(selector);
  return entries.length > 0 && entries.every(([key, value]) => resource.labels[key] === value);
}

export function resourceReferenceSearchText(resource: ResourceRow) {
  return resource.references
    .flatMap((reference) => [
      reference.kind,
      reference.name,
      reference.namespace,
      `${reference.kind}/${reference.name}`,
      `${reference.namespace}/${reference.name}`,
    ])
    .join(" ");
}

export function referencesResource(source: ResourceRow, target: ResourceRow) {
  return source.references.some((reference) =>
    target.kind === reference.kind &&
    target.name === reference.name &&
    (reference.namespace === "cluster" || target.namespace === reference.namespace),
  );
}
