import { GitBranch, Layers3, Network, type LucideIcon } from "lucide-react";
import { matchesSelector, ownsPod, workloadKinds } from "../lib/resourceRelationships";
import type { ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type PodLinkGroup = {
  title: string;
  icon: LucideIcon;
  resources: ResourceRow[];
};

export function PodLinkStrip({
  allResources,
  onOpenResource,
  pod,
}: {
  allResources: ResourceRow[];
  onOpenResource: (id: string) => void;
  pod: ResourceRow;
}) {
  const visibleLinks = podLinksFor(pod, allResources).filter((link) => link.resources.length);

  if (!visibleLinks.length) {
    return null;
  }

  return (
    <section className="pod-link-strip" aria-label="Pod relationships">
      {visibleLinks.map(({ icon: Icon, resources, title }) => (
        <article key={title}>
          <header>
            <Icon size={15} />
            <span>{title}</span>
            <strong>{resources.length}</strong>
          </header>
          <div>
            {resources.slice(0, 3).map((item) => (
              <button key={item.id} type="button" onClick={() => onOpenResource(item.id)}>
                <StatusDot state={item.status} />
                <span>{item.kind}</span>
                <strong>{item.name}</strong>
              </button>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}

function podLinksFor(pod: ResourceRow, resources: ResourceRow[]): PodLinkGroup[] {
  const namespaceResources = resources.filter((item) => item.namespace === pod.namespace);
  const ownerResources = uniqueResources([
    ...directOwnerResources(pod, namespaceResources),
    ...namespaceResources.filter((item) => workloadKinds.has(item.kind) && ownsPod(item, pod)),
  ]);
  const serviceResources = namespaceResources.filter((item) => item.kind === "Service" && matchesSelector(pod, item.selector));
  const namespace = resources.filter((item) => item.kind === "Namespace" && item.name === pod.namespace);

  return [
    { title: "Owner", icon: GitBranch, resources: ownerResources },
    { title: "Services", icon: Network, resources: serviceResources },
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
