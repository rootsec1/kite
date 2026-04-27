import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActionPreview, LiveSnapshot, ResourceDetails, ResourceRow } from "../types/kube";

type KubeContext = {
  name: string;
  cluster: string;
  user: string;
  current: boolean;
};

type ClusterProbe = {
  reachable: boolean;
  namespaces: string[];
  message: string;
};

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
  const [contexts, setContexts] = useState<KubeContext[]>([]);
  const [probe, setProbe] = useState<ClusterProbe | null>(null);
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

      return deferredQuery.split(/\s+/).every((term) => haystack.includes(term));
    });
  }, [deferredQuery, namespaceFilter, snapshot.resources, statusFilter]);

  const selectedResource = useMemo<ResourceRow | null>(() => {
    return visibleResources.find((resource) => resource.id === selectedId) ?? visibleResources[0] ?? null;
  }, [selectedId, visibleResources]);

  useEffect(() => {
    void refreshLiveSnapshot();
    void refreshKubeContexts();
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

  async function refreshKubeContexts() {
    if (!canUseTauri) {
      setContexts([
        { name: "edge-lab-k3d", cluster: "k3d-edge-lab", user: "local", current: true },
        { name: "prod-us-east-1", cluster: "eks-prod", user: "sre", current: false },
      ]);
      return;
    }

    setContexts(await invoke<KubeContext[]>("list_kube_contexts"));
  }

  async function probeDefaultCluster() {
    if (!canUseTauri) {
      const nextSnapshot = await fetch("/api/kube/snapshot").then((response) => response.json() as Promise<LiveSnapshot>);
      setSnapshot(nextSnapshot);
      setSelectedId((current) => current || nextSnapshot.resources[0]?.id || "");
      setProbe({
        reachable: true,
        namespaces: nextSnapshot.namespaceHeat.map((item) => item.namespace),
        message: "Live read complete",
      });
      return;
    }

    setProbe(await invoke<ClusterProbe>("probe_default_cluster"));
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
    contexts,
    detailsError,
    detailsLoading,
    error,
    loading,
    namespaceHeat: snapshot.namespaceHeat,
    namespaces,
    namespaceFilter,
    probe,
    query,
    resourceDetails,
    selectedResource,
    statusFilter,
    visibleResources,
    onProbeDefaultCluster: probeDefaultCluster,
    onPreviewAction: previewAction,
    onRefreshKubeContexts: refreshKubeContexts,
    onRefreshLiveSnapshot: refreshLiveSnapshot,
    onSelectResource: setSelectedId,
    onSetNamespaceFilter: setNamespaceFilter,
    onSetQuery: setQuery,
    onSetStatusFilter: setStatusFilter,
  };
}

export type KiteData = ReturnType<typeof useKiteData>;
