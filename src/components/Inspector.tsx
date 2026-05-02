import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Check, Copy, PanelRightClose, PanelRightOpen, Search } from "lucide-react";
import { copyTextToClipboard } from "../lib/clipboard";
import type { ResourceDetails, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type CopyStatus = "idle" | "copied" | "failed";

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
  const [query, setQuery] = useState("");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const yamlText = detailsLoading ? "Loading YAML..." : details.yaml || detailsError || "No YAML returned.";
  const yamlLines = useMemo(() => yamlText.split(/\r?\n/), [yamlText]);
  const queryTerms = useMemo(() => (deferredQuery ? deferredQuery.split(/\s+/) : []), [deferredQuery]);
  const visibleLines = useMemo(() => {
    if (!queryTerms.length) {
      return yamlLines.map((line, index) => ({ line, number: index + 1 }));
    }

    return yamlLines
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => {
        const haystack = line.toLowerCase();
        return queryTerms.every((term) => haystack.includes(term));
      });
  }, [queryTerms, yamlLines]);
  const CopyIcon = copyStatus === "copied" ? Check : Copy;
  const copyLabel = copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Blocked" : "Copy";

  async function copyYaml() {
    if (!details.yaml) {
      return;
    }

    try {
      await copyTextToClipboard(details.yaml);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }

    const timeout = window.setTimeout(() => setCopyStatus("idle"), 1_600);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  return (
    <details className="inspector-yaml">
      <summary>
        <span>Live object</span>
        <small>{queryTerms.length ? `${visibleLines.length}/${yamlLines.length} lines` : `${yamlLines.length} lines`}</small>
      </summary>
      <div className="inspector-yaml-toolbar">
        <label>
          <Search size={13} />
          <input
            aria-label="Find YAML"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find YAML..."
          />
        </label>
        <button
          className={copyStatus === "idle" ? "" : copyStatus}
          disabled={!details.yaml}
          title="Copy full YAML"
          type="button"
          onClick={copyYaml}
        >
          <CopyIcon size={13} />
          <span>{copyLabel}</span>
        </button>
      </div>
      <div aria-label="Live object YAML" className="inspector-yaml-code">
        {visibleLines.length ? (
          visibleLines.map(({ line, number }) => (
            <span className="yaml-line" key={number}>
              <span>{number}</span>
              <code>{line || " "}</code>
            </span>
          ))
        ) : (
          <span className="yaml-empty">No matching YAML lines</span>
        )}
      </div>
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
