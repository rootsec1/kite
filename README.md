<p align="center">
  <img src="src-tauri/icons/icon.png" width="96" height="96" alt="Kite app icon" />
</p>

<h1 align="center">Kite</h1>

<p align="center">
  A native, UI-first Kubernetes cockpit for developers debugging real clusters.
</p>

[![CI](https://github.com/rootsec1/kite/actions/workflows/ci.yml/badge.svg)](https://github.com/rootsec1/kite/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-24c8db.svg)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-kube--rs-b7410e.svg)](https://kube.rs)
[![Bun](https://img.shields.io/badge/Bun-first-111111.svg)](https://bun.sh)

Kite is a native, UI-first Kubernetes cockpit built with Tauri, Rust, React, and Bun.

The product moat is the interface: a simple native control-plane lens, macOS glass, reusable motion, and guarded Kubernetes actions without dashboard clutter.

![Kite overview](docs/assets/kite-overview.png)

## Highlights

- Native macOS-first app shell built with Tauri 2.
- Multi-context kubeconfig discovery with explicit context switching.
- Live Kubernetes resource inventory with namespace, status, label, search, sorting, and pressure signals.
- Persistent pinned resources for fast returns to active incidents.
- Grouped drilldowns from namespaces, services, workloads, and pods.
- Pod debugging workspace with status, containers, mounted dependencies, events, searchable source- and level-filtered logs, exec and port-forward handoff, guarded restart, and guarded delete.
- Local-first architecture with no cluster-side agent.
- Guarded write model for risky Kubernetes actions.

## Principles

- Local-first Kubernetes inspection with no cluster-side agent.
- Developer debugging workflows over generic dashboard clutter.
- Guarded writes: destructive actions must show the exact cluster, namespace, resource, and risk.
- No writes to non-local clusters during development or tests.

## Development

```bash
bun install
bun run dev
```

Prerequisites:

- Bun
- Rust stable
- Tauri system dependencies
- `kubectl`
- Optional local cluster: k3d, kind, minikube, or Docker Desktop Kubernetes

## Install

Kite is available from the public Homebrew tap:

```bash
brew tap rootsec1/kite
brew install --cask kite
```

Current macOS builds are unsigned and not notarized. On first launch, macOS may block Kite as an unidentified developer. Open it with right-click > Open, or use System Settings > Privacy & Security > Open Anyway after the first blocked launch.

Kite is not in the official `Homebrew/homebrew-cask` tap yet. The public custom tap is the supported install path until the app is signed/notarized and passes Homebrew's new-cask notability audit.

## Local Kubernetes Demo

```bash
chmod +x scripts/k3d-demo.sh
scripts/k3d-demo.sh
```

## Validation

```bash
bun run build
cd src-tauri && cargo check
```

## macOS Packaging

```bash
bun run tauri:build
```

Release artifacts are written to `src-tauri/target/release/bundle/macos/Kite.app` and `src-tauri/target/release/bundle/dmg/`.
Public distribution uses the GitHub release workflow and Homebrew cask flow in [docs/release.md](docs/release.md). Current macOS builds are unsigned and not notarized, so Gatekeeper may show an unidentified developer warning on first launch.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributors are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities through GitHub private vulnerability reporting or the process in [SECURITY.md](SECURITY.md).
