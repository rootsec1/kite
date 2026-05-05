# Kite Product Spec

Kite is a native Kubernetes GUI focused on interface quality, speed, and local-first safety.

## What

- Tauri 2 desktop app with Rust backend and React frontend.
- Multi-cluster Kubernetes cockpit with kubeconfig context switching, scoped resource exploration, pinned resources, keyboard-operable windowed sortable signal-aware inventory with selected-pod log jump actions, inline pod and service backend diagnostics, namespace ResourceQuota and LimitRange constraint visibility, HPA scale-target links, pod ServiceAccount identity links, ConfigMap/Secret/PVC/ServiceAccount consumer links, PriorityClass and RuntimeClass placement links, PodDisruptionBudget availability links, NetworkPolicy-to-pod visibility, exact Ingress/HTTPRoute-to-service topology links, CRD group/scope/version inspection, pod-to-node and node-to-pod debugging jumps, node condition/capacity inspection, pod-level status diagnostics, pod placement constraints, pod condition diagnostics, newest-first warning-prioritized pod events, exec and port-forward handoff, guarded pod actions, guarded workload rollout restart and scaling, searchable log workflows, YAML/diff inspection, and a simple visual control-plane map.
- UI-first design system inspired by Endex's dense enterprise sections: dark green-black glass, thin grid lines, pale telemetry surfaces, emerald accents, and precise motion.

## Why

Kubernetes GUIs often expose raw object data through nested dashboards. Kite should make cluster state visually obvious with fewer surfaces and make dangerous actions explicit.

## Key Decisions

- Bun is the default JavaScript toolchain.
- `kube-rs` is the backend Kubernetes client foundation.
- Write actions are supported but guarded with explicit target confirmation.
- No agentic layer is included in the first interface. Keep the product visual and direct.
- No cluster-side agent is required.

## Edge Cases

- Missing kubeconfig should produce a visible local setup state, not a crash.
- Missing metrics-server should degrade the metrics panels without blocking resource browsing.
- Remote-cluster writes must be user-initiated and confirmed.
- Large clusters require virtualized or windowed resource surfaces before live data replaces the demo data.
