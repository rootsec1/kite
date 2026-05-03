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
          <DescribeObject details={details} detailsError={detailsError} detailsLoading={detailsLoading} />
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
    <SearchableDetailText
      ariaLabel="Live object YAML"
      copyText={details.yaml}
      copyTitle="Copy full YAML"
      emptyMessage="No matching YAML lines"
      loadingText="Loading YAML..."
      placeholder="Find YAML..."
      searchLabel="Find YAML"
      text={details.yaml || detailsError}
      title="Live object"
      unavailableText="No YAML returned."
      detailsLoading={detailsLoading}
    />
  );
}

function DescribeObject({
  details,
  detailsError,
  detailsLoading,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
}) {
  return (
    <SearchableDetailText
      ariaLabel="Resource describe output"
      copyText={details.describe}
      copyTitle="Copy describe output"
      emptyMessage="No matching describe lines"
      loadingText="Loading describe..."
      placeholder="Find describe..."
      searchLabel="Find describe"
      text={details.describe || detailsError}
      title="Describe"
      unavailableText="No describe output returned."
      detailsLoading={detailsLoading}
    />
  );
}

function SearchableDetailText({
  ariaLabel,
  copyText,
  copyTitle,
  detailsLoading,
  emptyMessage,
  loadingText,
  placeholder,
  searchLabel,
  text,
  title,
  unavailableText,
}: {
  ariaLabel: string;
  copyText: string;
  copyTitle: string;
  detailsLoading: boolean;
  emptyMessage: string;
  loadingText: string;
  placeholder: string;
  searchLabel: string;
  text: string;
  title: string;
  unavailableText: string;
}) {
  const [query, setQuery] = useState("");
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const panelText = detailsLoading ? loadingText : text || unavailableText;
  const panelLines = useMemo(() => panelText.split(/\r?\n/), [panelText]);
  const queryTerms = useMemo(() => (deferredQuery ? deferredQuery.split(/\s+/) : []), [deferredQuery]);
  const visibleLines = useMemo(() => {
    if (!queryTerms.length) {
      return panelLines.map((line, index) => ({ line, number: index + 1 }));
    }

    return panelLines
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => {
        const haystack = line.toLowerCase();
        return queryTerms.every((term) => haystack.includes(term));
      });
  }, [panelLines, queryTerms]);
  const CopyIcon = copyStatus === "copied" ? Check : Copy;
  const copyLabel = copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Blocked" : "Copy";

  async function copyPanelText() {
    if (!copyText) {
      return;
    }

    try {
      await copyTextToClipboard(copyText);
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
        <span>{title}</span>
        <small>{queryTerms.length ? `${visibleLines.length}/${panelLines.length} lines` : `${panelLines.length} lines`}</small>
      </summary>
      <div className="inspector-yaml-toolbar">
        <label>
          <Search size={13} />
          <input
            aria-label={searchLabel}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
          />
        </label>
        <button
          className={copyStatus === "idle" ? "" : copyStatus}
          disabled={!copyText}
          title={copyTitle}
          type="button"
          onClick={copyPanelText}
        >
          <CopyIcon size={13} />
          <span>{copyLabel}</span>
        </button>
      </div>
      <div aria-label={ariaLabel} className="inspector-yaml-code">
        {visibleLines.length ? (
          visibleLines.map(({ line, number }) => (
            <span className="yaml-line" key={number}>
              <span>{number}</span>
              <code>{line || " "}</code>
            </span>
          ))
        ) : (
          <span className="yaml-empty">{emptyMessage}</span>
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
