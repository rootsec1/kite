import { AlertTriangle, GitBranch, HardDrive, Layers3, Network, Server, type LucideIcon } from "lucide-react";
import { matchesSelector, ownsPod, workloadKinds } from "../lib/resourceRelationships";
import type { ResourceReference, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type PodLinkGroup = {
  title: string;
  icon: LucideIcon;
  resources: ResourceRow[];
  missing?: ResourceReference[];
};

export function PodLinkStrip({
  allResources,
  nodeName,
  onOpenResource,
  pod,
}: {
  allResources: ResourceRow[];
  nodeName?: string;
  onOpenResource: (id: string) => void;
  pod: ResourceRow;
}) {
  const visibleLinks = podLinksFor(pod, allResources, nodeName).filter((link) => link.resources.length || link.missing?.length);

  if (!visibleLinks.length) {
    return null;
  }

  return (
    <section className="pod-link-strip" aria-label="Pod relationships">
      {visibleLinks.map(({ icon: Icon, missing = [], resources, title }) => (
        <article className={missing.length && !resources.length ? "warning" : ""} key={title}>
          <header>
            <Icon size={15} />
            <span>{title}</span>
            <strong>{resources.length + missing.length}</strong>
          </header>
          <div>
            {resources.slice(0, 3).map((item) => (
              <button key={item.id} type="button" onClick={() => onOpenResource(item.id)}>
                <StatusDot state={item.status} />
                <span title={item.kind}>{compactKind(item.kind)}</span>
                <strong>{item.name}</strong>
              </button>
            ))}
            {missing.slice(0, 3).map((reference) => (
              <span className="pod-link-missing" key={`${reference.kind}-${reference.namespace}-${reference.name}`}>
                <AlertTriangle size={13} />
                <span title={reference.kind}>{compactKind(reference.kind)}</span>
                <strong title={`${reference.namespace}/${reference.name}`}>{reference.name}</strong>
              </span>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function podLinksFor(pod: ResourceRow, resources: ResourceRow[], nodeName = ""): PodLinkGroup[] {
  const namespaceResources = resources.filter((item) => item.namespace === pod.namespace);
  const ownerResources = uniqueResources([
    ...directOwnerResources(pod, namespaceResources),
    ...namespaceResources.filter((item) => workloadKinds.has(item.kind) && ownsPod(item, pod)),
  ]);
  const serviceResources = namespaceResources.filter((item) => item.kind === "Service" && matchesSelector(pod, item.selector));
  const inputResources = resources.filter((item) => pod.references.some((reference) => matchesReference(item, reference)));
  const missingInputs = missingReferences(pod.references, resources);
  const node = nodeName ? resources.filter((item) => item.kind === "Node" && item.name === nodeName) : [];
  const namespace = resources.filter((item) => item.kind === "Namespace" && item.name === pod.namespace);

  return [
    { title: "Owner", icon: GitBranch, resources: ownerResources },
    { title: "Node", icon: Server, resources: node },
    { title: "Services", icon: Network, resources: serviceResources },
    { title: "Inputs", icon: HardDrive, resources: inputResources },
    { title: "Missing inputs", icon: AlertTriangle, resources: [], missing: missingInputs },
    { title: "Namespace", icon: Layers3, resources: namespace },
  ];
}

function directOwnerResources(pod: ResourceRow, resources: ResourceRow[]) {
  const [kind, name] = pod.owner.split("/", 2);
  if (!kind || !name) {
    return [];
  }

  const direct = resources.filter((item) => item.kind === kind && item.name === name);
  if (direct.length || kind !== "ReplicaSet") {
    return direct;
  }

  const deploymentName = deploymentNameFromReplicaSet(name);
  return deploymentName
    ? resources.filter((item) => item.kind === "Deployment" && item.name === deploymentName)
    : [];
}

function deploymentNameFromReplicaSet(name: string) {
  return name.split("-").slice(0, -1).join("-");
}

function uniqueResources(resources: ResourceRow[]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    if (seen.has(resource.id)) {
      return false;
    }
    seen.add(resource.id);
    return true;
  });
}

function matchesReference(resource: ResourceRow, reference: ResourceRow["references"][number]) {
  return resource.kind === reference.kind && resource.namespace === reference.namespace && resource.name === reference.name;
}

function missingReferences(references: ResourceReference[], resources: ResourceRow[]) {
  return references.filter((reference) => !resources.some((resource) => matchesReference(resource, reference)));
}

function compactKind(kind: string) {
  switch (kind) {
    case "ConfigMap":
      return "CM";
    case "PersistentVolumeClaim":
      return "PVC";
    case "PersistentVolume":
      return "PV";
    case "StatefulSet":
      return "STS";
    default:
      return kind;
  }
}
