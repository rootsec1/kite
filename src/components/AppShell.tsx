import { useCallback, useMemo, useRef, useState } from "react";
import type { KiteData } from "../hooks/useKiteData";
import { defaultResourceSort, nextResourceSort, sortResources } from "../lib/resourceSort";
import { pinnedResourcesNavId } from "../theme/resourceTheme";
import type { ResourceRow } from "../types/kube";
import { ControlPlaneMap } from "./ControlPlaneMap";
import { Inspector } from "./Inspector";
import { navSections, Sidebar } from "./navigation";
import { PodTriageRail, podMatchesTriageBucket, podTriageBucketLabel, shouldTriagePod, type PodTriageBucketId } from "./PodTriageRail";
import { ResourceDetail } from "./ResourceDetail";
import { NamespacePressure, ResourceTable, ScopeTabs, SummaryStrip, Toolbar } from "./workspace";

type AppShellProps = {
  data: KiteData;
  usesNativeWindowControls: boolean;
};

const navItems = navSections.flatMap((section) => section.items);

export function AppShell({ data, usesNativeWindowControls }: AppShellProps) {
  const [activeId, setActiveId] = useState("overview");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailIntent, setDetailIntent] = useState<"logs" | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [podTriageBucketId, setPodTriageBucketId] = useState<PodTriageBucketId | null>(null);
  const [resourceSort, setResourceSort] = useState(defaultResourceSort);
  const primaryPaneRef = useRef<HTMLDivElement>(null);
  const activeItem = useMemo(() => navItems.find((item) => item.id === activeId), [activeId]);
  const activeSection = useMemo(
    () => navSections.find((section) => section.items.some((item) => item.id === activeId)),
    [activeId],
  );
  const scopeTabs = activeSection && activeSection.title !== "Pinned" && activeSection.items.length > 1 ? activeSection.items : [];

  const counts = useMemo(() => countByKind(data.visibleResources), [data.visibleResources]);
  const scopedResources = useMemo(() => {
    const baseResources = activeId === pinnedResourcesNavId
      ? data.pinnedResources
      : activeItem?.kind
      ? data.visibleResources.filter((resource) => resource.kind === activeItem.kind)
      : data.visibleResources;
    const resources = podTriageBucketId && (!activeItem?.kind || activeItem.kind === "Pod")
      ? baseResources.filter((resource) => resource.kind === "Pod" && podMatchesTriageBucket(resource, podTriageBucketId))
      : baseResources;

    return sortResources(resources, resourceSort);
  }, [activeId, activeItem?.kind, data.pinnedResources, data.visibleResources, podTriageBucketId, resourceSort]);
  const warningCount = useMemo(
    () => data.visibleResources.filter((resource) => resource.status !== "healthy").length,
    [data.visibleResources],
  );
  const podTriageResources = useMemo(
    () => sortResources(data.visibleResources.filter(shouldTriagePod), defaultResourceSort),
    [data.visibleResources],
  );

  const clusterName = data.clusters[0]?.name ?? data.selectedContext ?? "No context";
  const detailResource = detailOpen ? data.selectedResource : null;
  const activeScopeLabel = podTriageBucketId && (!activeItem?.kind || activeItem.kind === "Pod")
    ? `Pods / ${podTriageBucketLabel(podTriageBucketId)}`
    : activeItem?.label ?? "Overview";
  const activeFilterCount = [
    data.query.trim(),
    data.namespaceFilter !== "all",
    data.statusFilter !== "all",
    data.labelFilter !== "all",
    Boolean(podTriageBucketId),
  ].filter(Boolean).length;

  const openResource = useCallback((id: string, intent: "logs" | null = null) => {
    data.onSelectResource(id);
    setDetailIntent(intent);
    setDetailOpen(true);
    window.requestAnimationFrame(() => primaryPaneRef.current?.scrollTo({ top: 0 }));
  }, [data.onSelectResource]);

  const openResourceLogs = useCallback((id: string) => openResource(id, "logs"), [openResource]);

  function selectNavigation(id: string) {
    setActiveId(id);
    setPodTriageBucketId(null);
    setDetailIntent(null);
    setDetailOpen(false);
    window.requestAnimationFrame(() => primaryPaneRef.current?.scrollTo({ top: 0 }));
  }

  function selectPodTriageBucket(id: PodTriageBucketId | null) {
    setActiveId("Pod");
    setPodTriageBucketId(id);
    setDetailIntent(null);
    setDetailOpen(false);
    window.requestAnimationFrame(() => primaryPaneRef.current?.scrollTo({ top: 0 }));
  }

  function selectPressureNamespace(namespace: string) {
    data.onSetNamespaceFilter(namespace);
    setPodTriageBucketId(null);
    setDetailIntent(null);
    setDetailOpen(false);
    window.requestAnimationFrame(() => primaryPaneRef.current?.scrollTo({ top: 0 }));
  }

  function clearWorkspaceFilters() {
    data.onClearResourceFilters();
    setPodTriageBucketId(null);
  }

  return (
    <div className="kite-window">
      <div className="control-center">
        <Sidebar
          activeId={activeId}
          clusterName={clusterName}
          counts={counts}
          pinnedCount={data.pinnedCount}
          showWindowControlFallback={!usesNativeWindowControls}
          onSelect={selectNavigation}
        />

        <main className="workspace">
          <Toolbar
            activeFilterCount={activeFilterCount}
            count={scopedResources.length}
            data={data}
            scope={activeScopeLabel}
            onClearFilters={clearWorkspaceFilters}
          />
          <section className={inspectorOpen ? "content-grid" : "content-grid inspector-collapsed"}>
            <div className="primary-pane" ref={primaryPaneRef}>
              {detailResource ? (
                <ResourceDetail
                  allResources={data.allResources}
                  details={data.resourceDetails}
                  detailsError={data.detailsError}
                  detailsLoading={data.detailsLoading}
                  initialFocus={detailIntent}
                  isPinned={data.isPinnedResource(detailResource)}
                  resource={detailResource}
                  result={data.podActionResult}
                  onBack={() => {
                    setDetailIntent(null);
                    setDetailOpen(false);
                  }}
                  onOpenResource={openResource}
                  onRefreshDetails={data.onRefreshResourceDetails}
                  onRunPodAction={data.onRunPodAction}
                  onTogglePinned={() => data.onTogglePinnedResource(detailResource)}
                />
              ) : (
                <>
                  {activeId === "overview" ? (
                    <ControlPlaneMap resources={data.visibleResources} onSelectKind={selectNavigation} />
                  ) : null}
                  <SummaryStrip
                    counts={counts}
                    reviewActive={data.statusFilter === "review"}
                    warningCount={warningCount}
                    onSelectReview={() => data.onSetStatusFilter(data.statusFilter === "review" ? "all" : "review")}
                  />
                  {(!activeItem?.kind || activeItem.kind === "Pod") ? (
                    <PodTriageRail
                      activeBucketId={podTriageBucketId}
                      pods={podTriageResources}
                      onOpenLogs={openResourceLogs}
                      onSelect={openResource}
                      onSelectBucket={selectPodTriageBucket}
                    />
                  ) : null}
                  <ScopeTabs activeId={activeId} counts={counts} items={scopeTabs} onSelect={selectNavigation} />
                  <ResourceTable
                    resources={scopedResources}
                    selectedId={data.selectedResource?.id ?? ""}
                    showKind={!activeItem?.kind}
                    showNode={activeItem?.kind === "Pod"}
                    showOwner={activeItem?.kind === "Pod"}
                    sort={resourceSort}
                    pinnedResourceKeys={data.pinnedResourceKeys}
                    title={activeScopeLabel === "Overview" ? "Resource inventory" : activeScopeLabel}
                    onFocusResource={data.onSelectResource}
                    onOpenResource={openResource}
                    onOpenResourceLogs={(id) => openResource(id, "logs")}
                    onSort={(key) => setResourceSort((current) => nextResourceSort(current, key))}
                    onTogglePinnedResource={data.onTogglePinnedResource}
                  />
                  <NamespacePressure
                    heat={data.namespaceHeat}
                    selectedNamespace={data.namespaceFilter}
                    onSelectNamespace={selectPressureNamespace}
                  />
                </>
              )}
            </div>

            <Inspector
              collapsed={!inspectorOpen}
              details={data.resourceDetails}
              detailsError={data.detailsError}
              detailsLoading={data.detailsLoading}
              error={data.error}
              resource={data.selectedResource}
              onToggle={() => setInspectorOpen((open) => !open)}
            />
          </section>
        </main>
      </div>
    </div>
  );
}

function countByKind(resources: ResourceRow[]) {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
  }
  return counts;
}
