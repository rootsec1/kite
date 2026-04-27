import type { CSSProperties } from "react";
import { Gauge, RefreshCw, Search } from "lucide-react";
import type { KiteData } from "../hooks/useKiteData";
import type { NamespaceHeat, ResourceRow } from "../types/kube";
import { overviewCards } from "./navigation";
import { StatusDot } from "./status";

export function Toolbar({ count, data, scope }: { count: number; data: KiteData; scope: string }) {
  return (
    <header className="toolbar">
      <div className="traffic-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <label className="search-box">
        <Search size={16} />
        <input
          value={data.query}
          onChange={(event) => data.onSetQuery(event.target.value)}
          placeholder="Search resources..."
        />
        <kbd>⌘ K</kbd>
      </label>
      <span className="scope-readout">{scope} · {count}</span>
      <button className={data.loading ? "icon-button loading" : "icon-button"} type="button" onClick={data.onRefreshLiveSnapshot}>
        <RefreshCw size={16} />
      </button>
    </header>
  );
}

export function SummaryStrip({ counts, warningCount }: { counts: Map<string, number>; warningCount: number }) {
  return (
    <section className="summary-strip" aria-label="Cluster summary">
      {overviewCards.map((card, index) => {
        const Icon = card.icon;
        return (
          <article className="summary-card" key={card.kind} style={{ "--delay": `${index * 65}ms` } as CSSProperties}>
            <Icon size={20} />
            <span>{card.label}</span>
            <strong>{counts.get(card.kind) ?? 0}</strong>
            <small>live</small>
          </article>
        );
      })}
      <article className="summary-card risk" style={{ "--delay": "260ms" } as CSSProperties}>
        <Gauge size={20} />
        <span>Warnings</span>
        <strong>{warningCount}</strong>
        <small>needs review</small>
      </article>
    </section>
  );
}

export function ResourceTable({
  resources,
  selectedId,
  title,
  onSelect,
}: {
  resources: ResourceRow[];
  selectedId: string;
  title: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="resource-panel">
      <header>
        <div>
          <span>Grouped resources</span>
          <h2>{title}</h2>
        </div>
        <small>{resources.length} visible</small>
      </header>

      <div className="resource-table">
        <div className="table-head">
          <span>Name</span>
          <span>Kind</span>
          <span>Namespace</span>
          <span>Status</span>
          <span>Age</span>
        </div>
        <div className="table-body">
          {resources.length ? (
            resources.map((resource, index) => (
              <button
                className={resource.id === selectedId ? "resource-row selected" : "resource-row"}
                key={resource.id}
                style={{ "--delay": `${Math.min(index, 18) * 28}ms` } as CSSProperties}
                type="button"
                onClick={() => onSelect(resource.id)}
              >
                <span className="name-cell">
                  <StatusDot state={resource.status} />
                  <strong>{resource.name}</strong>
                </span>
                <span>{resource.kind}</span>
                <span>{resource.namespace}</span>
                <span className={`status-chip ${resource.status}`}>{resource.status}</span>
                <span>{resource.age}</span>
              </button>
            ))
          ) : (
            <div className="empty-state">
              <strong>No live resources in this group</strong>
              <span>Switch groups or clear the search filter.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function NamespacePressure({ heat }: { heat: NamespaceHeat[] }) {
  return (
    <section className="pressure-panel">
      <header>
        <span>Namespace pressure</span>
        <strong>{heat.length} namespaces</strong>
      </header>
      <div className="pressure-list">
        {heat.slice(0, 8).map((item) => {
          const pressure = Math.max(item.cpu, item.memory);
          return (
            <div className="pressure-row" key={item.namespace}>
              <span>{item.namespace}</span>
              <div>
                <i style={{ "--value": `${pressure}%` } as CSSProperties} />
              </div>
              <small>{pressure}%</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
