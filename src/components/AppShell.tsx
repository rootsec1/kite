import { useMemo, useRef, useState } from "react";
import type { KiteData } from "../hooks/useKiteData";
import { defaultResourceSort, nextResourceSort, sortResources } from "../lib/resourceSort";
import { pinnedResourcesNavId } from "../theme/resourceTheme";
import type { ResourceRow } from "../types/kube";
import { Inspector } from "./Inspector";
import { navSections, Sidebar } from "./navigation";
import { PodTriageRail, shouldTriagePod } from "./PodTriageRail";
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
    const resources = activeId === pinnedResourcesNavId
      ? data.pinnedResources
      : activeItem?.kind
      ? data.visibleResources.filter((resource) => resource.kind === activeItem.kind)
      : data.visibleResources;

    return sortResources(resources, resourceSort);
  }, [activeId, activeItem?.kind, data.pinnedResources, data.visibleResources, resourceSort]);
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

  function openResource(id: string, intent: "logs" | null = null) {
    data.onSelectResource(id);
    setDetailIntent(intent);
    setDetailOpen(true);
    window.requestAnimationFrame(() => primaryPaneRef.current?.scrollTo({ top: 0 }));
  }

  function selectNavigation(id: string) {
    setActiveId(id);
    setDetailIntent(null);
    setDetailOpen(false);
    window.requestAnimationFrame(() => primaryPaneRef.current?.scrollTo({ top: 0 }));
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
          <Toolbar count={scopedResources.length} data={data} scope={activeItem?.label ?? "Overview"} />
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
                  <SummaryStrip counts={counts} warningCount={warningCount} />
                  {(!activeItem?.kind || activeItem.kind === "Pod") ? (
                    <PodTriageRail pods={podTriageResources} onSelect={openResource} />
                  ) : null}
                  <ScopeTabs activeId={activeId} counts={counts} items={scopeTabs} onSelect={selectNavigation} />
                  <ResourceTable
                    resources={scopedResources}
                    selectedId={data.selectedResource?.id ?? ""}
                    showKind={!activeItem?.kind}
                    sort={resourceSort}
                    pinnedResourceKeys={data.pinnedResourceKeys}
                    title={activeItem?.label ?? "Resource inventory"}
                    onFocusResource={data.onSelectResource}
                    onOpenResource={openResource}
                    onOpenResourceLogs={(id) => openResource(id, "logs")}
                    onSort={(key) => setResourceSort((current) => nextResourceSort(current, key))}
                  />
                  <NamespacePressure heat={data.namespaceHeat} />
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
