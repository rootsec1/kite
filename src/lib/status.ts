import type { HealthState } from "../types/kube";

export function statusLabel(state: HealthState) {
  switch (state) {
    case "critical":
      return "critical";
    case "warning":
      return "warning";
    case "syncing":
      return "syncing";
    case "healthy":
      return "healthy";
  }
}
