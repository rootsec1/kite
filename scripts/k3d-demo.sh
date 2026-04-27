#!/usr/bin/env bash
set -euo pipefail

cluster_name="${1:-kite-demo}"

if ! command -v k3d >/dev/null 2>&1; then
  echo "k3d is required for the local Kite demo cluster." >&2
  exit 1
fi

if ! k3d cluster list "$cluster_name" >/dev/null 2>&1; then
  k3d cluster create "$cluster_name" --agents 2
fi

kubectl config use-context "k3d-$cluster_name"
kubectl create namespace checkout --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace observability --dry-run=client -o yaml | kubectl apply -f -
kubectl -n checkout create deployment checkout-api --image=nginx:1.27 --replicas=3 --dry-run=client -o yaml | kubectl apply -f -
kubectl -n checkout expose deployment checkout-api --port=80 --target-port=80 --dry-run=client -o yaml | kubectl apply -f -

echo "Kite demo cluster is ready: k3d-$cluster_name"
