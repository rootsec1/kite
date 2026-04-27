import { memo, useCallback, type CSSProperties } from "react";
import { ArrowDownUp, Gauge, RefreshCw, Search, Star, Tag } from "lucide-react";
import type { KiteData } from "../hooks/useKiteData";
import { primaryLabels } from "../lib/labels";
import { resourceIdentity } from "../lib/resourceIdentity";
import type { ResourceSort, ResourceSortKey } from "../lib/resourceSort";
import type { NamespaceHeat, ResourceRow } from "../types/kube";
import { overviewCards } from "./navigation";
import { StatusDot } from "./status";
import type { NavItem } from "../theme/resourceTheme";

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
      <select value={data.namespaceFilter} onChange={(event) => data.onSetNamespaceFilter(event.target.value)} aria-label="Namespace filter">
        <option value="all">All ns</option>
        {data.namespaces.map((namespace) => (
          <option key={namespace} value={namespace}>{namespace}</option>
        ))}
      </select>
      <select value={data.statusFilter} onChange={(event) => data.onSetStatusFilter(event.target.value)} aria-label="Status filter">
        <option value="all">All states</option>
        <option value="healthy">Ready</option>
        <option value="warning">Warn</option>
        <option value="critical">Fail</option>
        <option value="syncing">Sync</option>
      </select>
      <label className="label-filter">
        <Tag size={14} />
        <select value={data.labelFilter} onChange={(event) => data.onSetLabelFilter(event.target.value)} aria-label="Label filter">
          <option value="all">All labels</option>
          {data.labelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
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

export function ScopeTabs({
  activeId,
  counts,
  items,
  onSelect,
}: {
  activeId: string;
  counts: Map<string, number>;
  items: NavItem[];
  onSelect: (id: string) => void;
}) {
  if (items.length < 2) {
    return null;
  }

  return (
    <div className="scope-tabs" role="tablist" aria-label="Resource group">
      {items.map((item) => {
        const Icon = item.icon;
        const count = item.kind ? counts.get(item.kind) ?? 0 : 0;
        return (
          <button
            aria-selected={item.id === activeId}
            className={item.id === activeId ? "active" : ""}
            key={item.id}
            role="tab"
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <Icon size={14} />
            <span>{item.label}</span>
            <strong>{count}</strong>
          </button>
        );
      })}
    </div>
  );
}

export function ResourceTable({
  onSort,
  resources,
  selectedId,
  showKind,
  sort,
  pinnedResourceKeys,
  title,
  onSelect,
}: {
  onSort: (key: ResourceSortKey) => void;
  pinnedResourceKeys: Set<string>;
  resources: ResourceRow[];
  selectedId: string;
  showKind: boolean;
  sort: ResourceSort;
  title: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="resource-panel">
      <header>
        <div>
          <h2>{title}</h2>
        </div>
        <small>{resources.length} visible</small>
      </header>

      <div className={showKind ? "resource-table" : "resource-table without-kind"}>
        <div className="table-head" role="row">
          <SortableHead label="Name" sort={sort} sortKey="name" onSort={onSort} />
          {showKind ? <SortableHead label="Kind" sort={sort} sortKey="kind" onSort={onSort} /> : null}
          <SortableHead label="Namespace" sort={sort} sortKey="namespace" onSort={onSort} />
          <SortableHead label="Age" sort={sort} sortKey="age" onSort={onSort} />
          <SortableHead label="Signals" sort={sort} sortKey="signals" onSort={onSort} />
          <span>Labels</span>
        </div>
        <div className="table-body">
          {resources.length ? (
            resources.map((resource, index) => (
              <ResourceRowButton
                key={resource.id}
                index={index}
                resource={resource}
                selected={resource.id === selectedId}
                showKind={showKind}
                pinned={pinnedResourceKeys.has(resourceIdentity(resource))}
                onOpen={onSelect}
              />
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

const ResourceRowButton = memo(function ResourceRowButton({
  index,
  onOpen,
  pinned,
  resource,
  selected,
  showKind,
}: {
  index: number;
  onOpen: (id: string) => void;
  pinned: boolean;
  resource: ResourceRow;
  selected: boolean;
  showKind: boolean;
}) {
  const handleOpen = useCallback(() => onOpen(resource.id), [onOpen, resource.id]);

  return (
    <button
      className={selected ? "resource-row selected" : "resource-row"}
      style={{ "--delay": `${Math.min(index, 18) * 28}ms` } as CSSProperties}
      type="button"
      onClick={handleOpen}
    >
      <span className="name-cell">
        <StatusDot state={resource.status} />
        {pinned ? <Star className="pinned-marker" size={13} fill="currentColor" /> : null}
        <strong>{resource.name}</strong>
      </span>
      {showKind ? <span>{resource.kind}</span> : null}
      <span>{resource.namespace}</span>
      <span>{resource.age}</span>
      <SignalCell resource={resource} />
      <LabelPills resource={resource} />
    </button>
  );
});

function SortableHead({
  label,
  onSort,
  sort,
  sortKey,
}: {
  label: string;
  onSort: (key: ResourceSortKey) => void;
  sort: ResourceSort;
  sortKey: ResourceSortKey;
}) {
  const active = sort.key === sortKey;

  return (
    <span aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} role="columnheader">
      <button
        className={active ? "table-sort active" : "table-sort"}
        data-testid={`sort-${sortKey}`}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <ArrowDownUp size={12} />
      </button>
    </span>
  );
}

function SignalCell({ resource }: { resource: ResourceRow }) {
  return (
    <span className="signal-cell" aria-label={`${resource.cpu}% CPU, ${resource.memory}% memory, ${resource.restarts} restarts`}>
      <SignalBar label="cpu" value={resource.cpu} />
      <SignalBar label="mem" value={resource.memory} />
      <small>{resource.restarts}r</small>
    </span>
  );
}

function SignalBar({ label, value }: { label: string; value: number }) {
  const tone = value >= 70 ? "hot" : value >= 45 ? "warm" : "cool";

  return (
    <i className={`signal-bar ${tone}`} title={`${label} ${value}%`}>
      <span style={{ "--value": `${Math.max(0, Math.min(value, 100))}%` } as CSSProperties} />
    </i>
  );
}

function LabelPills({ resource }: { resource: ResourceRow }) {
  const labels = primaryLabels(resource);

  if (!labels.length) {
    return <span className="label-pills muted">none</span>;
  }

  return (
    <span className="label-pills">
      {labels.map((label) => (
        <small key={label}>{label}</small>
      ))}
    </span>
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
