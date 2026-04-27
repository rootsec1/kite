# Contributing to Kite

Kite is a local-first Kubernetes desktop app. The highest bar is simple, fast, useful debugging workflows with a polished native interface.

## Development Setup

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run build
cd src-tauri && cargo check
```

`cargo fmt` is expected when `rustfmt` is installed.

## Product Direction

- Keep the UI calm, minimal, and developer-focused.
- Prefer live Kubernetes data over mock data.
- Prefer grouped drilldowns over dumping raw YAML.
- Make pod debugging excellent: status, containers, logs, events, exec, restart, and guarded delete.
- Keep YAML/spec views available, but do not make them the primary surface unless the user is editing YAML.

## Kubernetes Safety

Do not run write operations against non-local clusters.

Allowed write-test targets:

- k3d
- kind
- minikube
- Docker Desktop Kubernetes

If a cluster is not clearly local, treat it as read-only. Destructive or risky actions must be guarded by explicit confirmation that includes cluster/context, namespace, kind, name, action, and risk.

## Code Style

- Keep files small and responsibilities clear.
- Reuse existing components, hooks, theme tokens, and Rust commands before adding new abstractions.
- Split state, presentation, parsing, and backend orchestration.
- Remove dead code, debug code, unused imports, and duplicate logic before opening a PR.
- Use Bun for frontend scripts.

## Pull Requests

Before opening a PR:

```bash
bun run build
cd src-tauri && cargo check
```

For UI changes, include screenshots or a short screen recording. For Kubernetes behavior changes, describe the cluster used for validation and whether any writes were performed.
