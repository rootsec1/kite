import { useMemo } from "react";
import { HardDrive } from "lucide-react";
import { referencesResource } from "../lib/resourceRelationships";
import type { HealthState, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type StorageBindingRailProps = {
  onOpenResource: (id: string) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
};

type StorageBinding = {
  claim?: ResourceRow;
  claims: ResourceRow[];
  consumers: ResourceRow[];
  storageClass?: ResourceRow;
  volume?: ResourceRow;
  volumes: ResourceRow[];
};

type StorageBindingItem = {
  description: string;
  meta: string;
  resource: ResourceRow;
  tone: HealthState;
};

const storageResourceKinds = new Set(["PersistentVolumeClaim", "PersistentVolume", "StorageClass"]);

export function StorageBindingRail({ onOpenResource, resource, resources }: StorageBindingRailProps) {
  const binding = useMemo(() => storageBindingFor(resource, resources), [resource, resources]);
  const items = useMemo(() => storageBindingItems(resource, binding), [binding, resource]);

  if (!storageResourceKinds.has(resource.kind)) {
    return null;
  }

  const tone = storageBindingTone(resource, binding);

  return (
    <section className={`workload-pod-rail service-backend-rail storage-binding-rail ${tone}`} aria-label="Storage binding">
      <header>
        <span>
          <HardDrive size={15} />
          Binding
        </span>
        <strong>{storageBindingSummary(resource, binding)}</strong>
        <small>{storageBindingMeta(resource, binding)}</small>
      </header>
      <div>
        {items.length ? (
          items.slice(0, 5).map((item) => (
            <button className={item.tone} key={item.resource.id} type="button" onClick={() => onOpenResource(item.resource.id)}>
              <StatusDot state={item.tone} />
              <strong title={item.resource.name}>{item.resource.name}</strong>
              <em title={item.description}>{item.description}</em>
              <small>{storageKindLabel(item.resource.kind)}</small>
              <small>{item.meta}</small>
            </button>
          ))
        ) : (
          <div className="service-backend-empty">
            <span>No storage links</span>
            <strong>This object has no live binding in the current snapshot.</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function storageBindingFor(resource: ResourceRow, resources: ResourceRow[]): StorageBinding {
  const claims = resources.filter((item) => item.kind === "PersistentVolumeClaim");
  const volumes = resources.filter((item) => item.kind === "PersistentVolume");
  const classes = resources.filter((item) => item.kind === "StorageClass");

  if (resource.kind === "PersistentVolumeClaim") {
    const volume = volumes.find((item) => item.name === resource.owner);
    const storageClass = classes.find((item) => item.name === resource.image);
    return {
      claim: resource,
      claims: [resource],
      consumers: storageConsumersFor([resource], resources),
      storageClass,
      volume,
      volumes: volume ? [volume] : [],
    };
  }

  if (resource.kind === "PersistentVolume") {
    const [namespace, name] = claimRef(resource.owner);
    const claim = claims.find((item) => item.namespace === namespace && item.name === name);
    const storageClass = classes.find((item) => item.name === resource.image);
    return {
      claim,
      claims: claim ? [claim] : [],
      consumers: claim ? storageConsumersFor([claim], resources) : [],
      storageClass,
      volume: resource,
      volumes: [resource],
    };
  }

  if (resource.kind === "StorageClass") {
    const classClaims = claims.filter((item) => item.image === resource.name);
    return {
      claims: classClaims,
      consumers: storageConsumersFor(classClaims, resources),
      storageClass: resource,
      volumes: volumes.filter((item) => item.image === resource.name),
    };
  }

  return { claims: [], consumers: [], volumes: [] };
}

function storageBindingItems(resource: ResourceRow, binding: StorageBinding): StorageBindingItem[] {
  const items: StorageBindingItem[] = [];

  if (binding.volume && binding.volume.id !== resource.id) {
    items.push(storageItem(binding.volume, "Persistent volume", binding.volume.owner || "unclaimed"));
  }
  if (binding.claim && binding.claim.id !== resource.id) {
    items.push(storageItem(binding.claim, "Claim", binding.claim.namespace));
  }
  if (binding.storageClass && binding.storageClass.id !== resource.id) {
    items.push(storageItem(binding.storageClass, "Storage class", binding.storageClass.owner || "class"));
  }

  const classUsage = resource.kind === "StorageClass"
    ? [...binding.claims, ...binding.volumes.filter((volume) => !binding.claims.some((claim) => claim.owner === volume.name))]
    : [];
  for (const item of classUsage.sort(compareStorageResources)) {
    items.push(storageItem(item, item.kind === "PersistentVolume" ? "Volume" : "Claim", item.owner || item.namespace));
  }

  for (const pod of binding.consumers.sort(compareStorageResources)) {
    items.push(storageItem(pod, pod.diagnostic || "Mounted by pod", `${pod.restarts}r`));
  }

  return items;
}

function storageItem(resource: ResourceRow, description: string, meta: string): StorageBindingItem {
  return {
    description,
    meta: meta || resource.status,
    resource,
    tone: resource.status,
  };
}

function storageBindingSummary(resource: ResourceRow, binding: StorageBinding) {
  if (resource.kind === "PersistentVolumeClaim") {
    return binding.volume ? `PV ${binding.volume.name}` : "No PV";
  }
  if (resource.kind === "PersistentVolume") {
    return binding.claim ? `PVC ${binding.claim.name}` : "Unclaimed";
  }
  return `${binding.claims.length} PVC / ${binding.volumes.length} PV`;
}

function storageBindingMeta(resource: ResourceRow, binding: StorageBinding) {
  if (resource.kind === "StorageClass") {
    return resource.image || resource.owner || "class";
  }
  return binding.storageClass?.name || resource.image || "no class";
}

function storageBindingTone(resource: ResourceRow, binding: StorageBinding): HealthState {
  if (resource.status !== "healthy") {
    return resource.status;
  }
  if (resource.kind === "PersistentVolumeClaim" && !binding.volume) {
    return "warning";
  }
  return "healthy";
}

function storageConsumersFor(claims: ResourceRow[], resources: ResourceRow[]) {
  return resources.filter((item) => item.kind === "Pod" && claims.some((claim) => referencesResource(item, claim)));
}

function claimRef(owner: string) {
  const [namespace = "", name = ""] = owner.split("/", 2);
  return [namespace, name] as const;
}

function compareStorageResources(left: ResourceRow, right: ResourceRow) {
  return resourceStatusRank(left) - resourceStatusRank(right) ||
    right.restarts - left.restarts ||
    left.namespace.localeCompare(right.namespace) ||
    left.name.localeCompare(right.name);
}

function resourceStatusRank(resource: ResourceRow) {
  switch (resource.status) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "syncing":
      return 2;
    case "healthy":
      return 3;
  }
}

function storageKindLabel(kind: string) {
  switch (kind) {
    case "PersistentVolumeClaim":
      return "PVC";
    case "PersistentVolume":
      return "PV";
    case "StorageClass":
      return "SC";
    default:
      return kind;
  }
}
