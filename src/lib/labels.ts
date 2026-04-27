import type { ResourceRow } from "../types/kube";

export type LabelFilterOption = {
  value: string;
  label: string;
  count: number;
};

const noisyLabelKeys = new Set([
  "batch.kubernetes.io/controller-uid",
  "controller-revision-hash",
  "controller-uid",
  "modifiedAt",
  "objectset.rio.cattle.io/hash",
  "pod-template-hash",
]);
const generatedValuePattern = /^[a-f0-9]{24,}$/i;
const priorityLabelKeys = [
  "app.kubernetes.io/name",
  "app",
  "k8s-app",
  "app.kubernetes.io/component",
  "component",
  "tier",
  "release",
];

export function labelFilterOptions(resources: ResourceRow[], limit = 48): LabelFilterOption[] {
  const counts = new Map<string, number>();

  for (const resource of resources) {
    for (const [key, value] of Object.entries(resource.labels)) {
      if (!isUsefulLabel(key, value)) continue;
      const label = formatLabel(key, value);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([label, count]) => ({ value: label, label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
}

export function matchesLabelFilter(resource: ResourceRow, filter: string) {
  if (filter === "all") return true;

  const [key, ...valueParts] = filter.split("=");
  const value = valueParts.join("=");
  return Boolean(key && value && resource.labels[key] === value);
}

export function primaryLabels(resource: ResourceRow, limit = 2) {
  return Object.entries(resource.labels)
    .filter(([key, value]) => isUsefulLabel(key, value))
    .sort(([leftKey], [rightKey]) => labelRank(leftKey) - labelRank(rightKey) || leftKey.localeCompare(rightKey))
    .slice(0, limit)
    .map(([key, value]) => `${compactLabelKey(key)}=${value}`);
}

function isUsefulLabel(key: string, value: string) {
  return Boolean(key && value && !noisyLabelKeys.has(key) && !generatedValuePattern.test(value));
}

function formatLabel(key: string, value: string) {
  return `${key}=${value}`;
}

function labelRank(key: string) {
  const index = priorityLabelKeys.indexOf(key);
  return index === -1 ? priorityLabelKeys.length : index;
}

function compactLabelKey(key: string) {
  return key.replace(/^app\.kubernetes\.io\//, "app/");
}
