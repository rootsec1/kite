import { referencesResource } from "./resourceRelationships";
import type { HealthState, ResourceRow } from "../types/kube";

export function relatedEventResourcesFor(resource: ResourceRow, resources: ResourceRow[]) {
  return resources.filter((item) => item.kind === "Event" && referencesEventTarget(item, resource));
}

export function compareEventResources(left: ResourceRow, right: ResourceRow) {
  return eventRank(left.status) - eventRank(right.status) ||
    eventTimestamp(right.age) - eventTimestamp(left.age) ||
    left.name.localeCompare(right.name);
}

export function eventResourceTone(events: ResourceRow[]): HealthState {
  if (events.some((event) => event.status === "critical")) {
    return "critical";
  }
  if (events.some((event) => event.status === "warning")) {
    return "warning";
  }
  if (events.every((event) => event.status === "syncing")) {
    return "syncing";
  }
  return "healthy";
}

export function formatEventResourceAge(age?: string) {
  if (!age) {
    return "";
  }

  const timestamp = Date.parse(age);
  if (Number.isNaN(timestamp)) {
    return age;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function referencesEventTarget(event: ResourceRow, target: ResourceRow) {
  return referencesResource(event, target) ||
    target.namespace === "cluster" && event.references.some((reference) =>
      reference.kind === target.kind &&
      reference.name === target.name
    );
}

function eventRank(status: HealthState) {
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

function eventTimestamp(age: string) {
  const timestamp = Date.parse(age);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
