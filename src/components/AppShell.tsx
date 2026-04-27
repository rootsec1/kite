import { useMemo, useState } from "react";
import type { KiteData } from "../hooks/useKiteData";
import type { ResourceRow } from "../types/kube";
import { Inspector } from "./Inspector";
import { KindView } from "./KindView";
import { navSections, Sidebar } from "./navigation";
import { NamespacePressure, ResourceTable, SummaryStrip, Toolbar } from "./workspace";

type AppShellProps = {
  data: KiteData;
};

export function AppShell({ data }: AppShellProps) {
  const [activeId, setActiveId] = useState("overview");
  const activeItem = navSections.flatMap((section) => section.items).find((item) => item.id === activeId);

  const counts = useMemo(() => countByKind(data.visibleResources), [data.visibleResources]);
  const scopedResources = useMemo(() => {
    if (!activeItem?.kind) {
      return data.visibleResources;
    }
    return data.visibleResources.filter((resource) => resource.kind === activeItem.kind);
  }, [activeItem?.kind, data.visibleResources]);

  const warningCount = data.visibleResources.filter((resource) => resource.status !== "healthy").length;
  const clusterName = data.clusters[0]?.name ?? "No context";

  return (
    <div className="kite-window">
      <div className="control-center">
        <Sidebar activeId={activeId} clusterName={clusterName} counts={counts} onSelect={setActiveId} />

        <main className="workspace">
          <Toolbar count={scopedResources.length} data={data} scope={activeItem?.label ?? "Overview"} />
          <section className="content-grid">
            <div className="primary-pane">
              <PageHeading loading={data.loading} resourceCount={data.visibleResources.length} title={activeItem?.label ?? "Overview"} />
              <SummaryStrip counts={counts} warningCount={warningCount} />
              <KindView kind={activeItem?.kind} resources={scopedResources} total={data.visibleResources.length} />
              <ResourceTable
                resources={scopedResources}
                selectedId={data.selectedResource?.id ?? ""}
                title={activeItem?.kind ? activeItem.label : "Resource inventory"}
                onSelect={data.onSelectResource}
              />
              <NamespacePressure heat={data.namespaceHeat} />
            </div>

            <Inspector
              error={data.error}
              resource={data.selectedResource}
              onPreviewAction={data.onPreviewAction}
            />
          </section>
        </main>
      </div>
    </div>
  );
}

function PageHeading({ loading, resourceCount, title }: { loading: boolean; resourceCount: number; title: string }) {
  return (
    <header className="page-heading">
      <div>
        <span>Live control center</span>
        <h1>{title}</h1>
      </div>
      <div className="sync-pill">
        <span />
        {loading ? "Reading cluster" : `${resourceCount} live resources`}
      </div>
    </header>
  );
}

function countByKind(resources: ResourceRow[]) {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
  }
  return counts;
}
