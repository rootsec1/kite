import { useMemo } from "react";
import { AlertTriangle, Clock3 } from "lucide-react";
import { compareEventResources, relatedEventResourcesFor } from "../lib/resourceEvents";
import type { ResourceDetails, ResourceEvent, ResourceRow } from "../types/kube";

export function PodEventRail({
  details,
  detailsError,
  detailsLoading,
  onOpenResource,
  resource,
  resources = [],
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  onOpenResource?: (id: string, intent?: "logs" | null) => void;
  resource?: ResourceRow;
  resources?: ResourceRow[];
}) {
  const { events, warningCount } = eventRailView(details.events);
  const eventResources = useMemo(
    () => resource ? relatedEventResourcesFor(resource, resources).sort(compareEventResources) : [],
    [resource, resources],
  );
  const linkedEvents = linkEventResources(events, eventResources);

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
        ) : linkedEvents.length ? (
          linkedEvents.map(({ event, eventResource }, index) => (
            <PodEventItem
              event={event}
              eventResource={eventResource}
              key={`${event.reason}-${event.age}-${index}`}
              onOpenResource={onOpenResource}
            />
          ))
        ) : (
          <PodEventEmpty label="No pod events" message={detailsError || "No warning or normal events returned."} />
        )}
      </div>
    </section>
  );
}

function PodEventItem({
  event,
  eventResource,
  onOpenResource,
}: {
  event: ResourceEvent;
  eventResource?: ResourceRow;
  onOpenResource?: (id: string, intent?: "logs" | null) => void;
}) {
  const warning = isWarningEvent(event);
  const count = eventCount(event);
  const content = (
    <>
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
    </>
  );

  if (eventResource && onOpenResource) {
    return (
      <button
        className={warning ? "pod-event-item warning linked" : "pod-event-item linked"}
        title={`Open Event ${eventResource.name}`}
        type="button"
        onClick={() => onOpenResource(eventResource.id)}
      >
        {content}
      </button>
    );
  }

  return (
    <article className={warning ? "pod-event-item warning" : "pod-event-item"}>
      {content}
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

function linkEventResources(events: ResourceEvent[], eventResources: ResourceRow[]) {
  const unusedResources = [...eventResources];

  return events.map((event) => {
    const resourceIndex = unusedResources.findIndex((resource) =>
      eventResourceType(resource).toLowerCase() === event.type.toLowerCase() &&
      resource.diagnostic === event.reason
    );
    const eventResource = resourceIndex >= 0 ? unusedResources.splice(resourceIndex, 1)[0] : undefined;

    return { event, eventResource };
  });
}

function eventResourceType(resource: ResourceRow) {
  if (resource.image) {
    return resource.image;
  }
  return resource.status === "warning" ? "Warning" : "Normal";
}
