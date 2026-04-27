import type { ResourceDetails, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

export function Inspector({
  details,
  detailsError,
  detailsLoading,
  error,
  resource,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  error: string;
  resource: ResourceRow | null;
}) {
  return (
    <aside className="inspector">
      <header>
        <span>Events</span>
        {resource ? <StatusDot state={resource.status} /> : null}
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
          <Detail key={`${event.reason}-${index}`} label={`${event.type} / ${event.reason}`} value={event.message || event.age} />
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
