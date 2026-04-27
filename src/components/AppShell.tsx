import { useMemo, useState } from "react";
import type { KiteData } from "../hooks/useKiteData";
import type { ResourceRow } from "../types/kube";
import { Inspector } from "./Inspector";
import { navSections, Sidebar } from "./navigation";
import { ResourceDetail } from "./ResourceDetail";
import { NamespacePressure, ResourceTable, ScopeTabs, SummaryStrip, Toolbar } from "./workspace";

type AppShellProps = {
  data: KiteData;
};

const navItems = navSections.flatMap((section) => section.items);

export function AppShell({ data }: AppShellProps) {
  const [activeId, setActiveId] = useState("overview");
  const [detailOpen, setDetailOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const activeItem = useMemo(() => navItems.find((item) => item.id === activeId), [activeId]);
  const activeSection = useMemo(
    () => navSections.find((section) => section.items.some((item) => item.id === activeId)),
    [activeId],
  );
  const scopeTabs = activeSection && activeSection.title !== "Pinned" && activeSection.items.length > 1 ? activeSection.items : [];

  const counts = useMemo(() => countByKind(data.visibleResources), [data.visibleResources]);
  const scopedResources = useMemo(() => {
    const resources = activeItem?.kind
      ? data.visibleResources.filter((resource) => resource.kind === activeItem.kind)
      : data.visibleResources;

    return resources.slice().sort(compareResourcesForDebugging);
  }, [activeItem?.kind, data.visibleResources]);
  const warningCount = useMemo(
    () => data.visibleResources.filter((resource) => resource.status !== "healthy").length,
    [data.visibleResources],
  );

  const clusterName = data.clusters[0]?.name ?? "No context";
  const detailResource = detailOpen ? data.selectedResource : null;

  function openResource(id: string) {
    data.onSelectResource(id);
    setDetailOpen(true);
  }

  function selectNavigation(id: string) {
    setActiveId(id);
    setDetailOpen(false);
  }

  return (
    <div className="kite-window">
      <div className="control-center">
        <Sidebar activeId={activeId} clusterName={clusterName} counts={counts} onSelect={selectNavigation} />

        <main className="workspace">
          <Toolbar count={scopedResources.length} data={data} scope={activeItem?.label ?? "Overview"} />
          <section className={inspectorOpen ? "content-grid" : "content-grid inspector-collapsed"}>
            <div className="primary-pane">
              {detailResource ? (
                <ResourceDetail
                  allResources={data.allResources}
                  details={data.resourceDetails}
                  detailsError={data.detailsError}
                  detailsLoading={data.detailsLoading}
                  resource={detailResource}
                  result={data.podActionResult}
                  onBack={() => setDetailOpen(false)}
                  onOpenResource={openResource}
                  onRefreshDetails={data.onRefreshResourceDetails}
                  onRunPodAction={data.onRunPodAction}
                />
              ) : (
                <>
                  <SummaryStrip counts={counts} warningCount={warningCount} />
                  <ScopeTabs activeId={activeId} counts={counts} items={scopeTabs} onSelect={selectNavigation} />
                  <ResourceTable
                    resources={scopedResources}
                    selectedId={data.selectedResource?.id ?? ""}
                    showKind={!activeItem?.kind}
                    title={activeItem?.label ?? "Resource inventory"}
                    onSelect={openResource}
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

const systemNamespaces = new Set(["cluster", "default", "kube-system", "kube-public", "kube-node-lease"]);
const statusRank = new Map([
  ["critical", 0],
  ["warning", 1],
  ["syncing", 2],
  ["healthy", 3],
]);

function compareResourcesForDebugging(left: ResourceRow, right: ResourceRow) {
  const statusDelta = (statusRank.get(left.status) ?? 4) - (statusRank.get(right.status) ?? 4);
  if (statusDelta !== 0) return statusDelta;

  const namespaceDelta = Number(systemNamespaces.has(left.namespace)) - Number(systemNamespaces.has(right.namespace));
  if (namespaceDelta !== 0) return namespaceDelta;

  const selectorDelta = Number(Object.keys(right.selector).length > 0) - Number(Object.keys(left.selector).length > 0);
  if (selectorDelta !== 0) return selectorDelta;

  return left.name.localeCompare(right.name);
}
