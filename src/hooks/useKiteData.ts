import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { labelFilterOptions, labelSearchText, matchesLabelFilter } from "../lib/labels";
import { resourceIdentity } from "../lib/resourceIdentity";
import { resourceReferenceSearchText } from "../lib/resourceRelationships";
import type { KubeContextSummary, LiveSnapshot, PodActionResult, ResourceDetails, ResourceRow } from "../types/kube";

const isViteDevBrowser = /^https?:\/\/(127\.0\.0\.1|localhost):1420$/.test(window.location.origin);
const canUseTauri = "__TAURI_INTERNALS__" in window && !isViteDevBrowser;
const pinnedStorageKey = "kite:pinned-resources:v1";
const selectedContextStorageKey = "kite:selected-context:v1";
const liveSnapshotIntervalMs = 15_000;
const emptyResourceDetails = (): ResourceDetails => ({
  yaml: "",
  describe: "",
  events: [],
  logs: "",
  previousLogs: "",
  node: undefined,
  pod: undefined,
  crd: undefined,
});

export function useKiteData() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>({
    clusters: [],
    namespaceHeat: [],
    resources: [],
  });
  const [contexts, setContexts] = useState<KubeContextSummary[]>([]);
  const [selectedContext, setSelectedContext] = useState(readSelectedContext);
  const [query, setQuery] = useState("");
  const [namespaceFilter, setNamespaceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [labelFilter, setLabelFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [pinnedResourceKeys, setPinnedResourceKeys] = useState<Set<string>>(readPinnedResourceKeys);
  const [podActionResult, setPodActionResult] = useState<PodActionResult | null>(null);
  const [resourceDetails, setResourceDetails] = useState<ResourceDetails>(emptyResourceDetails);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const snapshotRequestId = useRef(0);
  const detailsRequestId = useRef(0);

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const queryTerms = useMemo(() => (deferredQuery ? deferredQuery.split(/\s+/) : []), [deferredQuery]);
  const namespaces = useMemo(() => {
    return Array.from(new Set(snapshot.resources.map((resource) => resource.namespace))).sort();
  }, [snapshot.resources]);

  const scopedResources = useMemo(() => {
    return snapshot.resources.filter((resource) => {
      if (namespaceFilter !== "all" && resource.namespace !== namespaceFilter) {
        return false;
      }
      if (statusFilter === "review") {
        return resource.status !== "healthy";
      }
      if (statusFilter !== "all" && resource.status !== statusFilter) {
        return false;
      }
      return true;
    });
  }, [namespaceFilter, snapshot.resources, statusFilter]);

  const labelOptions = useMemo(() => labelFilterOptions(scopedResources), [scopedResources]);

  useEffect(() => {
    if (labelFilter !== "all" && !labelOptions.some((option) => option.value === labelFilter)) {
      setLabelFilter("all");
    }
  }, [labelFilter, labelOptions]);

  const visibleResources = useMemo(() => {
    return scopedResources.filter((resource) => {
      if (!matchesLabelFilter(resource, labelFilter)) {
        return false;
      }
      if (!deferredQuery) {
        return true;
      }

      const haystack = [
        resource.kind,
        resource.name,
        resource.namespace,
        resource.cluster,
        resource.owner,
        resource.nodeName,
        resource.status,
        resource.lastRestartAt,
        resource.image,
        resource.diagnostic,
        resourceReferenceSearchText(resource),
        labelSearchText(resource),
      ]
        .join(" ")
        .toLowerCase();

      return queryTerms.every((term) => haystack.includes(term));
    });
  }, [deferredQuery, labelFilter, queryTerms, scopedResources]);

  const pinnedResources = useMemo(() => {
    return visibleResources.filter((resource) => pinnedResourceKeys.has(resourceIdentity(resource)));
  }, [pinnedResourceKeys, visibleResources]);
  const pinnedCount = useMemo(() => {
    return snapshot.resources.filter((resource) => pinnedResourceKeys.has(resourceIdentity(resource))).length;
  }, [pinnedResourceKeys, snapshot.resources]);
  const resourcesById = useMemo(() => {
    return new Map(snapshot.resources.map((resource) => [resource.id, resource]));
  }, [snapshot.resources]);

  const selectedResource = useMemo<ResourceRow | null>(() => {
    return (selectedId ? resourcesById.get(selectedId) : undefined) ?? visibleResources[0] ?? null;
  }, [resourcesById, selectedId, visibleResources]);

  useEffect(() => {
    void refreshKubeContextsAndSnapshot();
  }, []);

  useEffect(() => {
    if (!selectedContext) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshLiveSnapshot(selectedContext, { showLoading: false });
    }, liveSnapshotIntervalMs);
    return () => window.clearInterval(interval);
  }, [selectedContext]);

  useEffect(() => {
    if (!selectedResource) {
      detailsRequestId.current += 1;
      setDetailsLoading(false);
      setDetailsError("");
      setResourceDetails(emptyResourceDetails());
      setPodActionResult(null);
      return;
    }

    setPodActionResult(null);
    setResourceDetails(emptyResourceDetails());
    void refreshResourceDetails(selectedResource, true);
  }, [selectedResource]);

  async function refreshKubeContextsAndSnapshot() {
    try {
      const nextContexts = await readKubeContexts();
      const nextContext = chooseContext(selectedContext, nextContexts);
      setContexts(nextContexts);
      setSelectedContext(nextContext);
      writeSelectedContext(nextContext);
      await refreshLiveSnapshot(nextContext);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read Kubernetes contexts");
      setLoading(false);
    }
  }

  async function refreshLiveSnapshot(contextOverride = selectedContext, options: { showLoading?: boolean } = {}) {
    const requestId = ++snapshotRequestId.current;
    if (options.showLoading !== false) {
      setLoading(true);
    }
    setError("");

    try {
      const nextSnapshot = await readLiveSnapshot(contextOverride);

      if (requestId !== snapshotRequestId.current) {
        return;
      }

      setSnapshot(nextSnapshot);
      setSelectedId((current) => nextSnapshot.resources.some((resource) => resource.id === current) ? current : nextSnapshot.resources[0]?.id || "");
    } catch (caught) {
      if (requestId === snapshotRequestId.current) {
        setError(caught instanceof Error ? caught.message : "Unable to read Kubernetes state");
      }
    } finally {
      if (requestId === snapshotRequestId.current) {
        setLoading(false);
      }
    }
  }

  async function readKubeContexts() {
    if (canUseTauri) {
      try {
        return await invoke<KubeContextSummary[]>("list_kube_contexts");
      } catch {
        // Tauri dev sometimes runs the same UI in a plain browser; the Vite API keeps local QA working.
      }
    }

    const response = await fetch("/api/kube/contexts");
    if (!response.ok) {
      throw new Error(`Kubernetes contexts failed: ${response.status}`);
    }
    const nextContexts = await response.json() as KubeContextSummary[];
    if (!Array.isArray(nextContexts)) {
      throw new Error("Kubernetes contexts response was not a list");
    }
    return nextContexts;
  }

  async function readLiveSnapshot(context: string) {
    if (canUseTauri) {
      try {
        return await invoke<LiveSnapshot>("live_snapshot", { context });
      } catch {
        // Tauri dev sometimes runs the same UI in a plain browser; the Vite API keeps local QA working.
      }
    }

    const params = new URLSearchParams();
    if (context) {
      params.set("context", context);
    }
    const response = await fetch(`/api/kube/snapshot?${params}`);
    if (!response.ok) {
      throw new Error(`Kubernetes snapshot failed: ${response.status}`);
    }
    const nextSnapshot = await response.json() as LiveSnapshot;
    if (!Array.isArray(nextSnapshot.resources)) {
      throw new Error("Kubernetes snapshot response did not include resources");
    }
    return nextSnapshot;
  }

  function switchContext(context: string) {
    setSelectedContext(context);
    writeSelectedContext(context);
    setNamespaceFilter("all");
    setLabelFilter("all");
    setSelectedId("");
    setPodActionResult(null);
    detailsRequestId.current += 1;
    setDetailsLoading(false);
    setDetailsError("");
    setResourceDetails(emptyResourceDetails());
    void refreshLiveSnapshot(context);
  }

  async function runPodAction(action: string, confirmed = false) {
    if (!selectedResource) {
      return;
    }

    const target = {
      kind: selectedResource.kind,
      name: selectedResource.name,
      namespace: selectedResource.namespace,
      cluster: selectedResource.cluster,
    };

    try {
      const result = canUseTauri
        ? await invoke<PodActionResult>("pod_action", { action, target, confirmed })
        : await fetch("/api/kube/pod-action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, target, confirmed }),
          }).then((response) => {
            if (!response.ok) {
              throw new Error(`Pod action failed: ${response.status}`);
            }
            return response.json() as Promise<PodActionResult>;
          });

      setPodActionResult(result);
      if (result.status === "executed") {
        void refreshLiveSnapshot();
        void refreshResourceDetails(selectedResource, true);
      }
    } catch (caught) {
      setPodActionResult({
        action,
        status: "failed",
        requiresConfirmation: false,
        command: "",
        output: "",
        message: caught instanceof Error ? caught.message : "Unable to run pod action",
      });
    }
  }

  const refreshSelectedResourceDetails = useCallback(async () => {
    if (!selectedResource) {
      return;
    }

    await refreshResourceDetails(selectedResource, true);
  }, [selectedResource]);

  const isPinnedResource = useCallback((resource: ResourceRow) => {
    return pinnedResourceKeys.has(resourceIdentity(resource));
  }, [pinnedResourceKeys]);

  const togglePinnedResource = useCallback((resource: ResourceRow) => {
    const key = resourceIdentity(resource);
    setPinnedResourceKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      writePinnedResourceKeys(next);
      return next;
    });
  }, []);

  const clearResourceFilters = useCallback(() => {
    setQuery("");
    setNamespaceFilter("all");
    setStatusFilter("all");
    setLabelFilter("all");
  }, []);

  async function refreshResourceDetails(resource: ResourceRow, commit = false) {
    const requestId = ++detailsRequestId.current;
    setDetailsLoading(true);
    setDetailsError("");

    const target = {
      kind: resource.kind,
      name: resource.name,
      namespace: resource.namespace,
      cluster: resource.cluster,
    };

    try {
      let details: ResourceDetails | null = null;
      if (canUseTauri) {
        try {
          details = await invoke<ResourceDetails>("resource_details", { target });
        } catch {
          // Tauri dev sometimes runs the same UI in a plain browser; the Vite API keeps local QA working.
        }
      }

      if (!details) {
        const params = new URLSearchParams({
          kind: target.kind,
          name: target.name,
          namespace: target.namespace,
          cluster: target.cluster,
        });
        const response = await fetch(`/api/kube/details?${params}`);
        if (!response.ok) {
          throw new Error(`Resource details failed: ${response.status}`);
        }
        details = await response.json() as ResourceDetails;
      }

      if (commit && detailsRequestId.current === requestId) {
        setResourceDetails(details);
      }
      return details;
    } catch (caught) {
      const fallback = emptyResourceDetails();
      if (detailsRequestId.current === requestId) {
        setDetailsError(caught instanceof Error ? caught.message : "Unable to read resource details");
        if (commit) {
          setResourceDetails(fallback);
        }
      }
      return fallback;
    } finally {
      if (detailsRequestId.current === requestId) {
        setDetailsLoading(false);
      }
    }
  }

  return {
    clusters: snapshot.clusters,
    contexts,
    allResources: snapshot.resources,
    detailsError,
    detailsLoading,
    error,
    loading,
    labelFilter,
    labelOptions,
    namespaceHeat: snapshot.namespaceHeat,
    namespaces,
    namespaceFilter,
    podActionResult,
    pinnedCount,
    pinnedResourceKeys,
    pinnedResources,
    query,
    resourceDetails,
    selectedResource,
    selectedContext,
    statusFilter,
    visibleResources,
    onRefreshLiveSnapshot: () => refreshLiveSnapshot(),
    onRefreshResourceDetails: refreshSelectedResourceDetails,
    onRunPodAction: runPodAction,
    onClearResourceFilters: clearResourceFilters,
    onTogglePinnedResource: togglePinnedResource,
    isPinnedResource,
    onSetLabelFilter: setLabelFilter,
    onSelectResource: setSelectedId,
    onSetNamespaceFilter: setNamespaceFilter,
    onSetQuery: setQuery,
    onSetSelectedContext: switchContext,
    onSetStatusFilter: setStatusFilter,
  };
}

export type KiteData = ReturnType<typeof useKiteData>;

function readPinnedResourceKeys() {
  try {
    const raw = window.localStorage.getItem(pinnedStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function writePinnedResourceKeys(keys: Set<string>) {
  try {
    window.localStorage.setItem(pinnedStorageKey, JSON.stringify(Array.from(keys).sort()));
  } catch {
    // Pinning should never break cluster browsing when local storage is unavailable.
  }
}

function readSelectedContext() {
  try {
    return window.localStorage.getItem(selectedContextStorageKey) ?? "";
  } catch {
    return "";
  }
}

function writeSelectedContext(context: string) {
  try {
    window.localStorage.setItem(selectedContextStorageKey, context);
  } catch {
    // Context selection is still usable for the current session without storage.
  }
}

function chooseContext(selectedContext: string, contexts: KubeContextSummary[]) {
  if (selectedContext && contexts.some((context) => context.name === selectedContext)) {
    return selectedContext;
  }
  return contexts.find((context) => context.current)?.name ?? contexts[0]?.name ?? "";
}
