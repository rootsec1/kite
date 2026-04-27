import type { CSSProperties } from "react";
import { Activity, AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import type { ResourceRow } from "../types/kube";
import { themeForKind } from "../theme/resourceTheme";

type StatusKey = ResourceRow["status"];

const statusOrder: Array<{ key: StatusKey; label: string; icon: typeof CheckCircle2 }> = [
  { key: "healthy", label: "Ready", icon: CheckCircle2 },
  { key: "warning", label: "Warn", icon: AlertTriangle },
  { key: "critical", label: "Fail", icon: AlertTriangle },
  { key: "syncing", label: "Sync", icon: CircleDashed },
];

export function KindView({
  kind,
  onAction,
  resources,
  total,
}: {
  kind?: string;
  onAction: (action: string) => void;
  resources: ResourceRow[];
  total: number;
}) {
  const theme = themeForKind(kind);
  const Icon = theme.icon;
  const counts = countStatuses(resources);
  const visibleTotal = Math.max(resources.length, 1);

  return (
    <section className={`kind-view ${theme.accent}`}>
      <div className="kind-hero">
        <Icon size={24} />
        <div>
          <span>{kind ? "Section" : "Overview"}</span>
          <strong>{theme.label}</strong>
        </div>
      </div>

      <div className="kind-actions" aria-label="Available actions">
        {theme.actions.map((action) => (
          <button key={action} type="button" onClick={() => onAction(action.toLowerCase().replaceAll(" ", "-"))}>
            <Activity size={14} />
            {action}
          </button>
        ))}
      </div>

      <div className="status-lanes">
        {statusOrder.map((status) => {
          const Icon = status.icon;
          const count = counts.get(status.key) ?? 0;
          return (
            <div className={`status-lane ${status.key}`} key={status.key}>
              <Icon size={14} />
              <span>{status.label}</span>
              <b>{count}</b>
              <i style={{ "--value": `${(count / visibleTotal) * 100}%` } as CSSProperties} />
            </div>
          );
        })}
      </div>

      <div className="kind-total">
        <span>Scope</span>
        <strong>{resources.length}</strong>
        <small>of {total}</small>
      </div>
    </section>
  );
}

function countStatuses(resources: ResourceRow[]) {
  const counts = new Map<StatusKey, number>();
  for (const resource of resources) {
    counts.set(resource.status, (counts.get(resource.status) ?? 0) + 1);
  }
  return counts;
}
