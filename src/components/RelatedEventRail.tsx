import { useMemo } from "react";
import { Clock3 } from "lucide-react";
import { compareEventResources, eventResourceTone, formatEventResourceAge, relatedEventResourcesFor } from "../lib/resourceEvents";
import type { ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type RelatedEventRailProps = {
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
};

export function RelatedEventRail({ onOpenResource, resource, resources }: RelatedEventRailProps) {
  const events = useMemo(() => relatedEventResourcesFor(resource, resources).sort(compareEventResources), [resource, resources]);

  if (resource.kind === "Pod" || resource.kind === "Event" || !events.length) {
    return null;
  }

  const visibleEvents = events.slice(0, 5);
  const warningCount = events.filter((event) => event.status !== "healthy").length;
  const tone = eventResourceTone(events);

  return (
    <section className={`workload-pod-rail service-backend-rail related-event-rail ${tone}`} aria-label="Related events">
      <header>
        <span>
          <Clock3 size={15} />
          Events
        </span>
        <strong>{warningCount ? `${warningCount}/${events.length} warning` : `${events.length} linked`}</strong>
        <small>{formatEventResourceAge(events[0]?.age) || resource.namespace}</small>
      </header>
      <div>
        {visibleEvents.map((event) => (
          <button className={event.status} key={event.id} type="button" onClick={() => onOpenResource(event.id)}>
            <StatusDot state={event.status} />
            <strong title={event.diagnostic || event.name}>{event.diagnostic || event.name}</strong>
            <em title={event.owner || event.name}>{event.owner || event.name}</em>
            <small>{event.image || event.status}</small>
            <small title={event.age}>{formatEventResourceAge(event.age)}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
