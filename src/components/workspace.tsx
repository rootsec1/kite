import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { ArrowDownUp, FileText, Gauge, RefreshCw, Search, Star, Tag } from "lucide-react";
import type { KiteData } from "../hooks/useKiteData";
import { primaryLabels } from "../lib/labels";
import { resourceIdentity } from "../lib/resourceIdentity";
import type { ResourceSort, ResourceSortKey } from "../lib/resourceSort";
import type { NamespaceHeat, ResourceRow } from "../types/kube";
import { overviewCards } from "./navigation";
import { StatusDot } from "./status";
import type { NavItem } from "../theme/resourceTheme";

const resourceRowHeight = 48;
const resourceRowOverscan = 8;

export function Toolbar({ count, data, scope }: { count: number; data: KiteData; scope: string }) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const syncState = data.error ? "critical" : data.loading ? "syncing" : "healthy";
  const syncLabel = data.error ? "Stale" : data.loading ? "Syncing" : "Live";

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <header className="toolbar">
      <label className="search-box">
        <Search size={16} />
        <input
          ref={searchInputRef}
          value={data.query}
          onChange={(event) => data.onSetQuery(event.target.value)}
          placeholder="Search name, namespace, label..."
        />
        <kbd>⌘ K</kbd>
      </label>
      <select
        value={data.contexts.some((context) => context.name === data.selectedContext) ? data.selectedContext : ""}
        onChange={(event) => data.onSetSelectedContext(event.target.value)}
        aria-label="Kubernetes context"
      >
        {data.contexts.length ? (
          data.contexts.map((context) => (
            <option key={context.name} value={context.name}>
              {context.current ? "* " : ""}{context.name}
            </option>
          ))
        ) : (
          <option value="">No contexts</option>
        )}
      </select>
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
      <span
        aria-label={`${scope}, ${count} visible, ${syncLabel} Kubernetes snapshot`}
        className={`scope-readout ${syncState}`}
        title={data.error || `${syncLabel} Kubernetes snapshot`}
      >
        <span>{scope} · {count}</span>
        <StatusDot state={syncState} />
        <strong>{syncLabel}</strong>
      </span>
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
  onFocusResource,
  onOpenResourceLogs,
  onOpenResource,
  onSort,
  resources,
  selectedId,
  showKind,
  sort,
  pinnedResourceKeys,
  title,
}: {
  onFocusResource: (id: string) => void;
  onOpenResourceLogs: (id: string) => void;
  onOpenResource: (id: string) => void;
  onSort: (key: ResourceSortKey) => void;
  pinnedResourceKeys: Set<string>;
  resources: ResourceRow[];
  selectedId: string;
  showKind: boolean;
  sort: ResourceSort;
  title: string;
}) {
  const tableBodyRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(resourceRowHeight);
  const selectedIndex = useMemo(() => resources.findIndex((resource) => resource.id === selectedId), [resources, selectedId]);
  const visibleWindow = useMemo(() => {
    if (!resources.length) {
      return { end: 0, start: 0 };
    }

    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - resourceRowOverscan);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + resourceRowOverscan * 2;
    return {
      start,
      end: Math.min(resources.length, start + Math.max(visibleCount, resourceRowOverscan * 2)),
    };
  }, [resources.length, rowHeight, scrollTop, viewportHeight]);
  const virtualRows = resources.slice(visibleWindow.start, visibleWindow.end);
  const topSpacerHeight = visibleWindow.start * rowHeight;
  const bottomSpacerHeight = Math.max(0, (resources.length - visibleWindow.end) * rowHeight);
  const tableViewSignature = `${title}|${sort.key}:${sort.direction}|${resources.length}|${resources[0]?.id ?? ""}`;
  const activeDescendantId = selectedIndex >= 0 ? resourceRowDomId(resources[selectedIndex]) : undefined;

  const handleTableScroll = useCallback(() => {
    setScrollTop(tableBodyRef.current?.scrollTop ?? 0);
  }, []);

  const moveSelection = useCallback((nextIndex: number) => {
    const resource = resources[Math.max(0, Math.min(nextIndex, resources.length - 1))];
    if (resource) {
      onFocusResource(resource.id);
    }
  }, [onFocusResource, resources]);

  const handleTableKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!resources.length) {
      return;
    }

    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveSelection(currentIndex + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveSelection(currentIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        moveSelection(0);
        break;
      case "End":
        event.preventDefault();
        moveSelection(resources.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        onOpenResource(resources[currentIndex].id);
        break;
      case "l":
      case "L": {
        const resource = resources[currentIndex];
        if (!event.metaKey && !event.ctrlKey && !event.altKey && resource?.kind === "Pod") {
          event.preventDefault();
          onOpenResourceLogs(resource.id);
        }
        break;
      }
    }
  }, [moveSelection, onOpenResource, onOpenResourceLogs, resources, selectedIndex]);

  useLayoutEffect(() => {
    const tableBodyElement = tableBodyRef.current;
    if (!tableBodyElement) {
      return;
    }
    const tableBody = tableBodyElement;

    function syncViewport() {
      const nextRowHeight = Number.parseFloat(getComputedStyle(tableBody).getPropertyValue("--resource-row-height"));

      setViewportHeight(tableBody.clientHeight);
      setScrollTop(tableBody.scrollTop);
      setRowHeight(Number.isFinite(nextRowHeight) && nextRowHeight > 0 ? nextRowHeight : resourceRowHeight);
    }

    syncViewport();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncViewport);
      return () => window.removeEventListener("resize", syncViewport);
    }

    const observer = new ResizeObserver(syncViewport);
    observer.observe(tableBody);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const tableBody = tableBodyRef.current;
    if (!tableBody) {
      return;
    }

    const maxScrollTop = Math.max(0, resources.length * rowHeight - tableBody.clientHeight);
    if (tableBody.scrollTop > maxScrollTop) {
      tableBody.scrollTop = maxScrollTop;
      setScrollTop(maxScrollTop);
    }
  }, [resources.length, rowHeight]);

  useEffect(() => {
    const tableBody = tableBodyRef.current;
    if (!tableBody) {
      return;
    }

    tableBody.scrollTop = 0;
    setScrollTop(0);
  }, [tableViewSignature]);

  useEffect(() => {
    const tableBody = tableBodyRef.current;
    if (!tableBody || selectedIndex < 0) {
      return;
    }

    const selectedTop = selectedIndex * rowHeight;
    const selectedBottom = selectedTop + rowHeight;
    const viewTop = tableBody.scrollTop;
    const viewBottom = viewTop + tableBody.clientHeight;
    let nextScrollTop = viewTop;

    if (selectedTop < viewTop) {
      nextScrollTop = selectedTop;
    } else if (selectedBottom > viewBottom) {
      nextScrollTop = selectedBottom - tableBody.clientHeight;
    }

    if (nextScrollTop !== viewTop) {
      tableBody.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
  }, [rowHeight, selectedIndex]);

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
        <div
          aria-activedescendant={activeDescendantId}
          aria-label={`${title} resources`}
          aria-rowcount={resources.length}
          className="table-body"
          ref={tableBodyRef}
          role="grid"
          tabIndex={0}
          onKeyDown={handleTableKeyDown}
          onScroll={handleTableScroll}
        >
          {resources.length ? (
            <>
              {topSpacerHeight ? <div aria-hidden="true" className="resource-table-spacer" style={{ blockSize: topSpacerHeight }} /> : null}
              {virtualRows.map((resource, index) => (
                <ResourceRowButton
                  key={resource.id}
                  index={visibleWindow.start + index}
                  resource={resource}
                  selected={resource.id === selectedId}
                  showKind={showKind}
                  pinned={pinnedResourceKeys.has(resourceIdentity(resource))}
                  onOpenLogs={onOpenResourceLogs}
                  onOpen={onOpenResource}
                />
              ))}
              {bottomSpacerHeight ? <div aria-hidden="true" className="resource-table-spacer" style={{ blockSize: bottomSpacerHeight }} /> : null}
            </>
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
  onOpenLogs,
  pinned,
  resource,
  selected,
  showKind,
}: {
  index: number;
  onOpen: (id: string) => void;
  onOpenLogs: (id: string) => void;
  pinned: boolean;
  resource: ResourceRow;
  selected: boolean;
  showKind: boolean;
}) {
  const handleOpen = useCallback(() => onOpen(resource.id), [onOpen, resource.id]);
  const handleOpenLogs = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onOpenLogs(resource.id);
  }, [onOpenLogs, resource.id]);
  const showLogsAction = selected && resource.kind === "Pod";

  return (
    <div
      aria-selected={selected}
      className={selected ? "resource-row selected" : "resource-row"}
      id={resourceRowDomId(resource)}
      role="row"
      style={{ "--delay": `${Math.min(index, 18) * 28}ms` } as CSSProperties}
      tabIndex={-1}
      onClick={handleOpen}
    >
      <span className="name-cell">
        <StatusDot state={resource.status} />
        {pinned ? <Star className="pinned-marker" size={13} fill="currentColor" /> : null}
        <strong>{resource.name}</strong>
        {resource.diagnostic ? (
          <small className={`resource-diagnostic ${resource.status}`} title={resource.diagnostic}>
            {resource.diagnostic}
          </small>
        ) : null}
      </span>
      {showKind ? <span>{resource.kind}</span> : null}
      <span>{resource.namespace}</span>
      <span title={resource.age}>{formatResourceAge(resource.age)}</span>
      <SignalCell resource={resource} />
      <span className="label-action-cell">
        <LabelPills resource={resource} />
        {showLogsAction ? (
          <button aria-label={`Open logs for ${resource.name}`} className="row-action" type="button" onClick={handleOpenLogs}>
            <FileText size={13} />
            <span>Logs</span>
          </button>
        ) : null}
      </span>
    </div>
  );
});

function resourceRowDomId(resource: ResourceRow) {
  return `resource-row-${resource.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

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

function formatResourceAge(age: string) {
  const timestamp = Date.parse(age);
  if (Number.isNaN(timestamp)) {
    return age;
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (elapsedSeconds < 60) {
    return "now";
  }

  const units = [
    { suffix: "y", seconds: 31_536_000 },
    { suffix: "mo", seconds: 2_592_000 },
    { suffix: "d", seconds: 86_400 },
    { suffix: "h", seconds: 3_600 },
    { suffix: "m", seconds: 60 },
  ];
  const unit = units.find((item) => elapsedSeconds >= item.seconds) ?? units[units.length - 1];
  return `${Math.floor(elapsedSeconds / unit.seconds)}${unit.suffix}`;
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

export function NamespacePressure({
  heat,
  onSelectNamespace,
  selectedNamespace,
}: {
  heat: NamespaceHeat[];
  onSelectNamespace: (namespace: string) => void;
  selectedNamespace: string;
}) {
  const rows = useMemo(() => [...heat].sort(namespacePressureSort).slice(0, 8), [heat]);

  return (
    <section className="pressure-panel">
      <header>
        <span>Namespace pressure</span>
        <strong>{heat.length} namespaces</strong>
      </header>
      <div className="pressure-list">
        {rows.map((item) => {
          const pressure = Math.max(item.cpu, item.memory);
          const selected = selectedNamespace === item.namespace;
          return (
            <button
              aria-pressed={selected}
              className={selected ? `pressure-row ${item.risk} active` : `pressure-row ${item.risk}`}
              key={item.namespace}
              title={`Filter resources to namespace ${item.namespace}`}
              type="button"
              onClick={() => onSelectNamespace(item.namespace)}
            >
              <span className="pressure-namespace">
                <StatusDot state={item.risk} />
                <strong title={item.namespace}>{item.namespace}</strong>
              </span>
              <div aria-label={`${item.namespace} pressure ${pressure}%`}>
                <i style={{ "--value": `${pressure}%` } as CSSProperties} />
              </div>
              <small
                className={item.restarts > 0 ? "pressure-restarts active" : "pressure-restarts"}
                title={`${item.restarts} pod restarts`}
              >
                {item.restarts}r
              </small>
              <small>{pressure}%</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function namespacePressureSort(left: NamespaceHeat, right: NamespaceHeat) {
  return (
    riskRank(left.risk) - riskRank(right.risk) ||
    right.restarts - left.restarts ||
    Math.max(right.cpu, right.memory) - Math.max(left.cpu, left.memory) ||
    left.namespace.localeCompare(right.namespace)
  );
}

function riskRank(risk: NamespaceHeat["risk"]) {
  switch (risk) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "syncing":
      return 2;
    case "healthy":
      return 3;
  }
}
