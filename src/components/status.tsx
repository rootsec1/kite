import type { HealthState } from "../types/kube";

export function StatusDot({ state }: { state: HealthState }) {
  return <i className={`status-dot ${state}`} />;
}
