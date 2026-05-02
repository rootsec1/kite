import { Container, GitBranch, Network, Server } from "lucide-react";
import type { HealthState, ResourceRow } from "../types/kube";
import { StatusDot } from "./status";

type ControlPlaneMapProps = {
  onSelectKind: (id: string) => void;
  resources: ResourceRow[];
};

type FlowStage = {
  id: string;
  label: string;
  metric: string;
  navId: string;
  tone: HealthState;
  value: string;
  icon: typeof Network;
};

const routeKinds = new Set(["Ingress", "Gateway", "HTTPRoute"]);

export function ControlPlaneMap({ onSelectKind, resources }: ControlPlaneMapProps) {
  const stages = controlPlaneStages(resources);
  const total = stages.reduce((sum, stage) => sum + Number(stage.value), 0);

  if (total === 0) {
    return null;
  }

  const tone = worstTone(stages.map((stage) => stage.tone));

  return (
    <section className={`control-plane-map ${tone}`} aria-label="Control-plane flow">
      <header>
        <span>
          <GitBranch size={15} />
          Control plane
        </span>
        <strong>{stageHealthLabel(stages)}</strong>
      </header>
      <div className="control-plane-flow">
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <div className="control-plane-hop" key={stage.id}>
              <button className={`control-plane-stage ${stage.tone}`} type="button" onClick={() => onSelectKind(stage.navId)}>
                <StatusDot state={stage.tone} />
                <Icon size={16} />
                <span>{stage.label}</span>
                <strong>{stage.value}</strong>
                <small>{stage.metric}</small>
              </button>
              {index < stages.length - 1 ? <FlowConnector label={connectorLabel(index, resources)} /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FlowConnector({ label }: { label: string }) {
  return (
    <span className="control-plane-connector" aria-label={label}>
      <i />
      <small>{label}</small>
    </span>
  );
}

function controlPlaneStages(resources: ResourceRow[]): FlowStage[] {
  const routes = resources.filter((resource) => routeKinds.has(resource.kind));
  const services = resources.filter((resource) => resource.kind === "Service");
  const pods = resources.filter((resource) => resource.kind === "Pod");
  const nodes = resources.filter((resource) => resource.kind === "Node");
  const readyServices = services.filter((service) => service.status === "healthy").length;
  const readyPods = pods.filter((pod) => pod.status === "healthy").length;
  const readyNodes = nodes.filter((node) => node.status === "healthy").length;
  const restarts = pods.reduce((sum, pod) => sum + pod.restarts, 0);

  return [
    {
      id: "entry",
      icon: Network,
      label: "Entry",
      metric: routeMetric(routes, resources),
      navId: primaryRouteNavId(routes),
      tone: worstTone(routes.map((route) => route.status)),
      value: String(routes.length),
    },
    {
      id: "service",
      icon: Network,
      label: "Services",
      metric: services.length ? `${readyServices}/${services.length} ready` : "none",
      navId: "Service",
      tone: worstTone(services.map((service) => service.status)),
      value: String(services.length),
    },
    {
      id: "pod",
      icon: Container,
      label: "Pods",
      metric: restarts ? `${restarts} restarts` : pods.length ? `${readyPods}/${pods.length} ready` : "none",
      navId: "Pod",
      tone: restarts ? worstTone(["warning", ...pods.map((pod) => pod.status)]) : worstTone(pods.map((pod) => pod.status)),
      value: String(pods.length),
    },
    {
      id: "node",
      icon: Server,
      label: "Nodes",
      metric: nodes.length ? `${readyNodes}/${nodes.length} ready` : "none",
      navId: "Node",
      tone: worstTone(nodes.map((node) => node.status)),
      value: String(nodes.length),
    },
  ];
}

function routeMetric(routes: ResourceRow[], resources: ResourceRow[]) {
  const serviceRefs = routes.flatMap((route) => route.references.filter((reference) => reference.kind === "Service"));
  if (!serviceRefs.length) {
    return routes.length ? "no service refs" : "none";
  }

  const matchedRefs = serviceRefs.filter((reference) =>
    resources.some((resource) =>
      resource.kind === "Service" &&
      resource.name === reference.name &&
      resource.namespace === reference.namespace,
    ),
  ).length;

  return `${matchedRefs}/${serviceRefs.length} refs`;
}

function connectorLabel(index: number, resources: ResourceRow[]) {
  if (index === 0) {
    const routeRefs = resources
      .filter((resource) => routeKinds.has(resource.kind))
      .reduce((sum, route) => sum + route.references.filter((reference) => reference.kind === "Service").length, 0);
    return routeRefs ? `${routeRefs} route refs` : "route refs";
  }

  if (index === 1) {
    const readyServices = resources.filter((resource) => resource.kind === "Service" && resource.status === "healthy").length;
    return readyServices ? `${readyServices} ready svc` : "backends";
  }

  const scheduledPods = resources.filter((resource) => resource.kind === "Pod" && resource.nodeName).length;
  return scheduledPods ? `${scheduledPods} scheduled` : "scheduled";
}

function primaryRouteNavId(routes: ResourceRow[]) {
  return routes.find((route) => route.kind === "HTTPRoute")?.kind ??
    routes.find((route) => route.kind === "Ingress")?.kind ??
    routes.find((route) => route.kind === "Gateway")?.kind ??
    "Ingress";
}

function stageHealthLabel(stages: FlowStage[]) {
  const degraded = stages.filter((stage) => stage.tone !== "healthy").length;
  return degraded ? `${degraded} degraded` : "clear";
}

function worstTone(states: HealthState[]): HealthState {
  if (states.includes("critical")) {
    return "critical";
  }
  if (states.includes("warning")) {
    return "warning";
  }
  if (states.includes("syncing")) {
    return "syncing";
  }
  return "healthy";
}
