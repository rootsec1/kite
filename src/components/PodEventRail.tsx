import { AlertTriangle, Clock3 } from "lucide-react";
import type { ResourceDetails, ResourceEvent } from "../types/kube";

export function PodEventRail({
  details,
  detailsError,
  detailsLoading,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
}) {
  const { events, warningCount } = eventRailView(details.events);

  return (
    <section className="pod-event-rail" aria-label="Pod event timeline">
      <header>
        <div>
          <span>Event rail</span>
          <strong>{detailsLoading ? "syncing" : `${details.events.length} events`}</strong>
        </div>
        {warningCount > 0 ? (
          <small className="warning">
            <AlertTriangle size={13} />
            {warningCount} warning
          </small>
        ) : (
          <small>
            <Clock3 size={13} />
            live
          </small>
        )}
      </header>

      <div className="pod-event-list">
        {detailsLoading ? (
          <PodEventEmpty label="Syncing events" message="Waiting for Kubernetes event data." />
        ) : events.length ? (
          events.map((event, index) => <PodEventItem event={event} key={`${event.reason}-${event.age}-${index}`} />)
        ) : (
          <PodEventEmpty label="No pod events" message={detailsError || "No warning or normal events returned."} />
        )}
      </div>
    </section>
  );
}

function PodEventItem({ event }: { event: ResourceEvent }) {
  const warning = isWarningEvent(event);
  const count = eventCount(event);

  return (
    <article className={warning ? "pod-event-item warning" : "pod-event-item"}>
      <i aria-hidden="true" />
      <div>
        <span>{event.type || "Normal"}</span>
        <strong>
          {event.reason || "Event"}
          {count > 1 ? <em>x{count}</em> : null}
        </strong>
      </div>
      <p>{event.message || event.age || "Event recorded."}</p>
      <time>{event.age || "live"}</time>
    </article>
  );
}

function PodEventEmpty({ label, message }: { label: string; message: string }) {
  return (
    <div className="pod-event-empty">
      <span>{label}</span>
      <strong>{message}</strong>
    </div>
  );
}

export function eventRailView(events: ResourceEvent[]) {
  const warnings: ResourceEvent[] = [];
  const normal: ResourceEvent[] = [];
  let warningCount = 0;

  for (const event of events) {
    if (isWarningEvent(event)) {
      warnings.push(event);
      warningCount += eventCount(event);
    } else {
      normal.push(event);
    }
  }

  return {
    events: [...warnings, ...normal].slice(0, 5),
    warningCount,
  };
}

function isWarningEvent(event: ResourceEvent) {
  return event.type.toLowerCase() === "warning";
}

function eventCount(event: ResourceEvent) {
  return Number.isFinite(event.count) && event.count > 0 ? event.count : 1;
}
