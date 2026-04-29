import { PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ResourceDetails, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

export function Inspector({
  collapsed,
  details,
  detailsError,
  detailsLoading,
  error,
  onToggle,
  resource,
}: {
  collapsed: boolean;
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  error: string;
  onToggle: () => void;
  resource: ResourceRow | null;
}) {
  if (collapsed) {
    return (
      <aside className="inspector-rail" aria-label="Collapsed inspector">
        <button type="button" onClick={onToggle} aria-label="Open inspector">
          <PanelRightOpen size={16} />
          <span>Events</span>
          {resource ? <StatusDot state={resource.status} /> : null}
        </button>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <header>
        <span>Events</span>
        <button type="button" onClick={onToggle} aria-label="Collapse inspector">
          <PanelRightClose size={16} />
        </button>
      </header>

      {resource ? (
        <>
          <h2>{resource.name}</h2>
          <p>{resource.kind} / {resource.namespace}</p>
          <EventList details={details} detailsError={detailsError} detailsLoading={detailsLoading} />
          <LiveObject details={details} detailsError={detailsError} detailsLoading={detailsLoading} />
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

function EventList({
  details,
  detailsError,
  detailsLoading,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
}) {
  return (
    <div className="event-pane">
      {detailsLoading ? (
        <Detail label="Events" value="Loading..." />
      ) : details.events.length ? (
        details.events.map((event, index) => (
          <Detail key={`${event.reason}-${index}`} label={eventLabel(event)} value={event.message || event.age} />
        ))
      ) : (
        <Detail label="Events" value={detailsError || "No events found"} />
      )}
    </div>
  );
}

function LiveObject({
  details,
  detailsError,
  detailsLoading,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
}) {
  return (
    <details className="inspector-yaml">
      <summary>Live object</summary>
      <pre>{detailsLoading ? "Loading YAML..." : details.yaml || detailsError || "No YAML returned."}</pre>
    </details>
  );
}

function eventLabel(event: ResourceDetails["events"][number]) {
  const count = Number.isFinite(event.count) && event.count > 1 ? ` x${event.count}` : "";
  return `${event.type} / ${event.reason}${count}`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
