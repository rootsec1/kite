import type { ResourceRow } from "../types/kube";

export function resourceIdentity(resource: ResourceRow) {
  return `${resource.cluster}:${resource.id}`;
}
