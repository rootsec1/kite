import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActionPreview, LiveSnapshot, ResourceDetails, ResourceRow } from "../types/kube";

const canUseTauri = "__TAURI_INTERNALS__" in window;

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
  const [actionPreview, setActionPreview] = useState<ActionPreview | null>(null);
  const [resourceDetails, setResourceDetails] = useState<ResourceDetails>({
    yaml: "",
    events: [],
    logs: "",
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
      const nextSnapshot = canUseTauri
        ? await invoke<LiveSnapshot>("live_snapshot")
        : await fetch("/api/kube/snapshot").then((response) => {
            if (!response.ok) {
              throw new Error(`Kubernetes snapshot failed: ${response.status}`);
            }
            return response.json() as Promise<LiveSnapshot>;
          });

      setSnapshot(nextSnapshot);
      setSelectedId((current) => current || nextSnapshot.resources[0]?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to read Kubernetes state");
    } finally {
      setLoading(false);
    }
  }

  async function previewAction(action: string) {
    const target = {
      kind: selectedResource?.kind ?? "Resource",
      name: selectedResource?.name ?? "none",
      namespace: selectedResource?.namespace ?? "default",
      cluster: selectedResource?.cluster ?? "current-context",
    };

    if (!canUseTauri) {
      setActionPreview({
        action,
        risk: action === "delete" ? "high" : "medium",
        requiresConfirmation: action !== "logs",
        message: `${action} will target ${target.kind}/${target.name} in ${target.cluster}.`,
      });
      return;
    }

    setActionPreview(await invoke<ActionPreview>("guarded_action_preview", { action, target }));
  }

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
    actionPreview,
    clusters: snapshot.clusters,
    detailsError,
    detailsLoading,
    error,
    loading,
    namespaceHeat: snapshot.namespaceHeat,
    namespaces,
    namespaceFilter,
    query,
    resourceDetails,
    selectedResource,
    statusFilter,
    visibleResources,
    onPreviewAction: previewAction,
    onRefreshLiveSnapshot: refreshLiveSnapshot,
    onSelectResource: setSelectedId,
    onSetNamespaceFilter: setNamespaceFilter,
    onSetQuery: setQuery,
    onSetStatusFilter: setStatusFilter,
  };
}

export type KiteData = ReturnType<typeof useKiteData>;
