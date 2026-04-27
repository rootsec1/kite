import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LiveSnapshot, PodActionResult, ResourceDetails, ResourceRow } from "../types/kube";

const isViteDevBrowser = /^https?:\/\/(127\.0\.0\.1|localhost):1420$/.test(window.location.origin);
const canUseTauri = "__TAURI_INTERNALS__" in window && !isViteDevBrowser;

export function useKiteData() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>({
    clusters: [],
    namespaceHeat: [],
    resources: [],
  });
  const [query, setQuery] = useState("");
  const [namespaceFilter, setNamespaceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [podActionResult, setPodActionResult] = useState<PodActionResult | null>(null);
  const [resourceDetails, setResourceDetails] = useState<ResourceDetails>({
    yaml: "",
    events: [],
    logs: "",
    pod: undefined,
  });
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const queryTerms = useMemo(() => (deferredQuery ? deferredQuery.split(/\s+/) : []), [deferredQuery]);
  const namespaces = useMemo(() => {
    return Array.from(new Set(snapshot.resources.map((resource) => resource.namespace))).sort();
  }, [snapshot.resources]);

  const visibleResources = useMemo(() => {
    return snapshot.resources.filter((resource) => {
      if (namespaceFilter !== "all" && resource.namespace !== namespaceFilter) {
        return false;
      }
      if (statusFilter !== "all" && resource.status !== statusFilter) {
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
        resource.status,
      ]
        .join(" ")
        .toLowerCase();

      return queryTerms.every((term) => haystack.includes(term));
    });
  }, [deferredQuery, namespaceFilter, queryTerms, snapshot.resources, statusFilter]);

  const selectedResource = useMemo<ResourceRow | null>(() => {
    return visibleResources.find((resource) => resource.id === selectedId) ?? visibleResources[0] ?? null;
  }, [selectedId, visibleResources]);

  useEffect(() => {
    void refreshLiveSnapshot();
  }, []);

  useEffect(() => {
    if (!selectedResource) {
      setResourceDetails({ yaml: "", events: [], logs: "" });
      setPodActionResult(null);
      return;
    }

    let cancelled = false;
    void refreshResourceDetails(selectedResource).then((details) => {
      if (!cancelled && details) {
        setResourceDetails(details);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedResource]);

  async function refreshLiveSnapshot() {
    setLoading(true);
    setError("");

    try {
      const nextSnapshot = await readLiveSnapshot();

      setSnapshot(nextSnapshot);
      setSelectedId((current) => current || nextSnapshot.resources[0]?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read Kubernetes state");
    } finally {
      setLoading(false);
    }
  }

  async function readLiveSnapshot() {
    if (canUseTauri) {
      try {
        return await invoke<LiveSnapshot>("live_snapshot");
      } catch {
        // Tauri dev sometimes runs the same UI in a plain browser; the Vite API keeps local QA working.
      }
    }

    const response = await fetch("/api/kube/snapshot");
    if (!response.ok) {
      throw new Error(`Kubernetes snapshot failed: ${response.status}`);
    }
    const nextSnapshot = await response.json() as LiveSnapshot;
    if (!Array.isArray(nextSnapshot.resources)) {
      throw new Error("Kubernetes snapshot response did not include resources");
    }
    return nextSnapshot;
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
        void refreshResourceDetails(selectedResource).then((details) => {
          if (details) {
            setResourceDetails(details);
          }
        });
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

    const details = await refreshResourceDetails(selectedResource);
    if (details) {
      setResourceDetails(details);
    }
  }, [selectedResource]);

  async function refreshResourceDetails(resource: ResourceRow) {
    setDetailsLoading(true);
    setDetailsError("");

    const target = {
      kind: resource.kind,
      name: resource.name,
      namespace: resource.namespace,
      cluster: resource.cluster,
    };

    try {
      if (canUseTauri) {
        return await invoke<ResourceDetails>("resource_details", { target });
      }

      const params = new URLSearchParams({
        kind: target.kind,
        name: target.name,
        namespace: target.namespace,
      });
      const response = await fetch(`/api/kube/details?${params}`);
      if (!response.ok) {
        throw new Error(`Resource details failed: ${response.status}`);
      }
      return await response.json() as ResourceDetails;
    } catch (caught) {
      setDetailsError(caught instanceof Error ? caught.message : "Unable to read resource details");
      return { yaml: "", events: [], logs: "" };
    } finally {
      setDetailsLoading(false);
    }
  }

  return {
    clusters: snapshot.clusters,
    allResources: snapshot.resources,
    detailsError,
    detailsLoading,
    error,
    loading,
    namespaceHeat: snapshot.namespaceHeat,
    namespaces,
    namespaceFilter,
    podActionResult,
    query,
    resourceDetails,
    selectedResource,
    statusFilter,
    visibleResources,
    onRefreshLiveSnapshot: refreshLiveSnapshot,
    onRefreshResourceDetails: refreshSelectedResourceDetails,
    onRunPodAction: runPodAction,
    onSelectResource: setSelectedId,
    onSetNamespaceFilter: setNamespaceFilter,
    onSetQuery: setQuery,
    onSetStatusFilter: setStatusFilter,
  };
}

export type KiteData = ReturnType<typeof useKiteData>;
