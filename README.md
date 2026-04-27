# Kite

Kite is a native, UI-first Kubernetes cockpit built with Tauri, Rust, React, and Bun.

The product moat is the interface: a simple native control-plane lens, macOS glass, reusable motion, and guarded Kubernetes actions without dashboard clutter.

## Development

```bash
bun install
bun run dev
```

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
