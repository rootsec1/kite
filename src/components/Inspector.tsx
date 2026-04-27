import { useState } from "react";
import { Braces, Clock3, FileText, TerminalSquare, type LucideIcon } from "lucide-react";
import type { ActionPreview, ResourceDetails, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

export function Inspector({
  actionPreview,
  details,
  detailsError,
  detailsLoading,
  error,
  resource,
  onPreviewAction,
}: {
  actionPreview: ActionPreview | null;
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  error: string;
  resource: ResourceRow | null;
  onPreviewAction: (action: string) => void;
}) {
  const [tab, setTab] = useState<"overview" | "yaml" | "logs" | "events">("overview");

  function openTab(nextTab: typeof tab) {
    setTab(nextTab);
    if (nextTab === "yaml" || nextTab === "logs") {
      onPreviewAction(nextTab);
    }
  }

  return (
    <aside className="inspector">
      <header>
        <span>Selected object</span>
        {resource ? <StatusDot state={resource.status} /> : null}
      </header>

      {resource ? (
        <>
          <h2>{resource.name}</h2>
          <p>{resource.kind} / {resource.namespace}</p>
          <div className="inspector-tabs">
            <TabButton active={tab === "overview"} icon={FileText} label="Info" onClick={() => openTab("overview")} />
            <TabButton active={tab === "yaml"} icon={Braces} label="YAML" onClick={() => openTab("yaml")} />
            <TabButton active={tab === "logs"} icon={TerminalSquare} label="Logs" onClick={() => openTab("logs")} />
            <TabButton active={tab === "events"} icon={Clock3} label="Events" onClick={() => openTab("events")} />
          </div>
          {actionPreview ? <ActionPreviewCard preview={actionPreview} /> : null}
          <InspectorTab details={details} detailsError={detailsError} detailsLoading={detailsLoading} resource={resource} tab={tab} />
        </>
      ) : (
        <div className="empty-state">
          <strong>Waiting for cluster</strong>
          <span>{error || "Read-only live snapshot."}</span>
        </div>
      )}
    </aside>
  );
}

function ActionPreviewCard({ preview }: { preview: ActionPreview }) {
  return (
    <div className={`action-preview ${preview.risk}`}>
      <span>{preview.risk}</span>
      <strong>{preview.action}</strong>
      <p>{preview.message}</p>
    </div>
  );
}

function TabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      <Icon size={14} />
      {label}
    </button>
  );
}

function InspectorTab({
  details,
  detailsError,
  detailsLoading,
  resource,
  tab,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  resource: ResourceRow;
  tab: "overview" | "yaml" | "logs" | "events";
}) {
  if (tab === "yaml") {
    return <pre className="code-pane">{detailsLoading ? "Loading YAML..." : details.yaml || detailsError || summaryYaml(resource)}</pre>;
  }

  if (tab === "logs") {
    return (
      <div className="log-pane">
        <span>{resource.kind === "Pod" ? "tail --240" : "logs are pod-scoped"}</span>
        <pre>{detailsLoading ? "Loading logs..." : details.logs || (resource.kind === "Pod" ? detailsError || "No log lines returned." : "Select a pod to stream logs.")}</pre>
      </div>
    );
  }

  if (tab === "events") {
    return (
      <div className="event-pane">
        {detailsLoading ? (
          <Detail label="Events" value="Loading..." />
        ) : details.events.length ? (
          details.events.map((event, index) => (
            <Detail key={`${event.reason}-${index}`} label={`${event.type} / ${event.reason}`} value={event.message || event.age} />
          ))
        ) : (
          <Detail label="Events" value={detailsError || "No events found"} />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="inspector-grid">
        <Metric label="CPU" value={`${resource.cpu}%`} />
        <Metric label="Memory" value={`${resource.memory}%`} />
        <Metric label="Restarts" value={String(resource.restarts)} />
        <Metric label="Age" value={resource.age} />
      </div>
      <div className="detail-list">
        <Detail label="Cluster" value={resource.cluster} />
        <Detail label="Owner" value={resource.owner || "none"} />
        <Detail label="Image" value={resource.image || "not reported"} />
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function summaryYaml(resource: ResourceRow) {
  return [
    `kind: ${resource.kind}`,
    "metadata:",
    `  name: ${resource.name}`,
    `  namespace: ${resource.namespace}`,
    "status:",
    `  phase: ${resource.status}`,
    `  restarts: ${resource.restarts}`,
    `image: ${resource.image || "unknown"}`,
  ].join("\n");
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
