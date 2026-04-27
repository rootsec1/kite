import type { ResourceRow } from "../types/kube";

export type ResourceSortKey = "triage" | "name" | "kind" | "namespace" | "age" | "signals";
export type ResourceSortDirection = "asc" | "desc";

export type ResourceSort = {
  key: ResourceSortKey;
  direction: ResourceSortDirection;
};

export const defaultResourceSort: ResourceSort = {
  key: "triage",
  direction: "asc",
};

const signalSortKeys = new Set<ResourceSortKey>(["age", "signals"]);
const systemNamespaces = new Set(["cluster", "default", "kube-system", "kube-public", "kube-node-lease"]);
const statusRank = new Map([
  ["critical", 0],
  ["warning", 1],
  ["syncing", 2],
  ["healthy", 3],
]);

export function nextResourceSort(current: ResourceSort, key: ResourceSortKey): ResourceSort {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    key,
    direction: signalSortKeys.has(key) ? "desc" : "asc",
  };
}

export function sortResources(resources: ResourceRow[], sort: ResourceSort) {
  return resources.slice().sort((left, right) => compareResources(left, right, sort));
}

function compareResources(left: ResourceRow, right: ResourceRow, sort: ResourceSort) {
  const base = sort.key === "triage"
    ? compareResourcesForDebugging(left, right)
    : compareResourceField(left, right, sort.key);

  if (base !== 0) {
    return sort.direction === "asc" ? base : -base;
  }

  return compareResourcesForDebugging(left, right);
}

function compareResourceField(left: ResourceRow, right: ResourceRow, key: ResourceSortKey) {
  switch (key) {
    case "name":
      return left.name.localeCompare(right.name);
    case "kind":
      return left.kind.localeCompare(right.kind);
    case "namespace":
      return left.namespace.localeCompare(right.namespace);
    case "age":
      return ageRank(left.age) - ageRank(right.age);
    case "signals":
      return signalRank(left) - signalRank(right);
    case "triage":
      return compareResourcesForDebugging(left, right);
  }
}

function compareResourcesForDebugging(left: ResourceRow, right: ResourceRow) {
  const statusDelta = (statusRank.get(left.status) ?? 4) - (statusRank.get(right.status) ?? 4);
  if (statusDelta !== 0) return statusDelta;

  const namespaceDelta = Number(systemNamespaces.has(left.namespace)) - Number(systemNamespaces.has(right.namespace));
  if (namespaceDelta !== 0) return namespaceDelta;

  const selectorDelta = Number(Object.keys(right.selector).length > 0) - Number(Object.keys(left.selector).length > 0);
  if (selectorDelta !== 0) return selectorDelta;

  return left.name.localeCompare(right.name);
}

function signalRank(resource: ResourceRow) {
  return Math.max(resource.cpu, resource.memory) + resource.restarts * 12;
}

function ageRank(age: string) {
  if (age === "live" || age === "today") {
    return 0;
  }

  const dayMatch = age.match(/^(\d+)d$/);
  if (dayMatch) {
    return Number(dayMatch[1]);
  }

  const timestamp = Date.parse(age);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  }

  return Number.MAX_SAFE_INTEGER;
}
