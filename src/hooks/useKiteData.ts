import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ActionPreview, LiveSnapshot, ResourceRow } from "../types/kube";

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
  const [selectedId, setSelectedId] = useState("");
  const [contexts, setContexts] = useState<KubeContext[]>([]);
  const [probe, setProbe] = useState<ClusterProbe | null>(null);
  const [actionPreview, setActionPreview] = useState<ActionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const visibleResources = useMemo(() => {
    if (!deferredQuery) {
      return snapshot.resources;
    }

    return snapshot.resources.filter((resource) => {
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
  }, [deferredQuery, snapshot.resources]);

  const selectedResource = useMemo<ResourceRow | null>(() => {
    return visibleResources.find((resource) => resource.id === selectedId) ?? visibleResources[0] ?? null;
  }, [selectedId, visibleResources]);

  useEffect(() => {
    void refreshLiveSnapshot();
    void refreshKubeContexts();
  }, []);

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

  return {
    actionPreview,
    clusters: snapshot.clusters,
    contexts,
    error,
    loading,
    namespaceHeat: snapshot.namespaceHeat,
    probe,
    query,
    selectedResource,
    visibleResources,
    onProbeDefaultCluster: probeDefaultCluster,
    onPreviewAction: previewAction,
    onRefreshKubeContexts: refreshKubeContexts,
    onRefreshLiveSnapshot: refreshLiveSnapshot,
    onSelectResource: setSelectedId,
    onSetQuery: setQuery,
  };
}

export type KiteData = ReturnType<typeof useKiteData>;
