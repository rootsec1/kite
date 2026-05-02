import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, Box, CheckCircle2, FileText, GitCommitHorizontal, ImageIcon, Network, RotateCw, ShieldAlert, Skull, Star, TerminalSquare } from "lucide-react";
import { containerCurrentState, containerLastState, currentStateTime, lastStateTime } from "../lib/podLifecycle";
import { matchesSelector, ownsPod, referencesResource, workloadKinds } from "../lib/resourceRelationships";
import type { ContainerDetails, HealthState, PodActionResult, PodCondition, ResourceDetails, ResourceRow } from "../types/kube";
import { PodEventRail } from "./PodEventRail";
import { PodIssueStrip } from "./PodIssueStrip";
import { PodLifecycleRail } from "./PodLifecycleRail";
import { PodLinkStrip } from "./PodLinkStrip";
import { PodPlacementStrip } from "./PodPlacementStrip";
import { PodTerminal, type LogMode } from "./PodTerminal";
import { StatusDot } from "./status";
import { StorageBindingRail } from "./StorageBindingRail";

type ResourceDetailProps = {
  allResources: ResourceRow[];
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  initialFocus: "logs" | null;
  isPinned: boolean;
  result: PodActionResult | null;
  resource: ResourceRow;
  onBack: () => void;
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  onRefreshDetails: () => void;
  onRunPodAction: (action: string, confirmed?: boolean) => void;
  onTogglePinned: () => void;
};

export function ResourceDetail({
  allResources,
  details,
  detailsError,
  detailsLoading,
  initialFocus,
  isPinned,
  onBack,
  onOpenResource,
  onRefreshDetails,
  onRunPodAction,
  onTogglePinned,
  resource,
  result,
}: ResourceDetailProps) {
  const isPod = resource.kind === "Pod";
  const hierarchyGroups = useMemo(() => hierarchyFor(resource, allResources), [allResources, resource]);
  const forwardedPorts = useMemo(() => podPorts(details), [details]);
  const terminalRef = useRef<HTMLElement>(null);
  const [terminalModeRequest, setTerminalModeRequest] = useState({ id: 0, mode: "current" as LogMode });

  useEffect(() => {
    if (!isPod) {
      return;
    }

    onRefreshDetails();
    const interval = window.setInterval(onRefreshDetails, 4_000);
    return () => window.clearInterval(interval);
  }, [isPod, onRefreshDetails, resource.id]);

  function scrollToTerminal() {
    window.requestAnimationFrame(() => {
      terminalRef.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }

  function openLogs(mode: LogMode = "current") {
    setTerminalModeRequest((current) => ({ id: current.id + 1, mode }));
    onRefreshDetails();
    scrollToTerminal();
  }

  useEffect(() => {
    if (!isPod || initialFocus !== "logs") {
      return;
    }

    setTerminalModeRequest((current) => ({ id: current.id + 1, mode: "current" }));
    scrollToTerminal();
  }, [initialFocus, isPod, resource.id]);

  return (
    <section className="detail-workspace">
      <header className="detail-hero">
        <button className="back-button" type="button" onClick={onBack}>
          <ArrowLeft size={15} />
          Resources
        </button>
        <div className="detail-title-block">
          <span className="detail-kind">
            <StatusDot state={resource.status} />
            {resource.kind} / {resource.namespace}
          </span>
          <h2 title={resource.name}>{resource.name}</h2>
          <div className="detail-meta-row" aria-label="Resource metadata">
            <span>{resource.cluster || "current"}</span>
            <span>{resource.age}</span>
            {resource.owner ? <span>{resource.owner}</span> : null}
          </div>
        </div>
        <button
          aria-pressed={isPinned}
          className={isPinned ? "pin-button active" : "pin-button"}
          type="button"
          onClick={onTogglePinned}
        >
          <Star size={15} fill={isPinned ? "currentColor" : "none"} />
          {isPinned ? "Pinned" : "Pin"}
        </button>
      </header>

      {isPod ? (
        <>
          <PodIssueStrip details={details} resource={resource} onOpenPreviousLogs={() => openLogs("previous")} />
          <PodStatusPanel details={details} resource={resource} />
          <PodLifecycleRail details={details} />
          <PodPlacementStrip pod={details.pod} />
          <PodLinkStrip
            allResources={allResources}
            nodeName={details.pod?.nodeName || resource.nodeName}
            pod={resource}
            onOpenResource={onOpenResource}
          />
          <div className="pod-actions" aria-label="Pod actions">
            <button type="button" onClick={() => openLogs()}>
              <FileText size={15} />
              Logs
            </button>
            <button type="button" onClick={() => onRunPodAction("exec")}>
              <TerminalSquare size={15} />
              Exec
            </button>
            {forwardedPorts.map((port) => (
              <button
                aria-label={`Port-forward pod port ${port}`}
                key={port}
                title={`Port-forward pod port ${port}`}
                type="button"
                onClick={() => onRunPodAction(`port-forward:${port}`)}
              >
                <Network size={15} />
                {port}
              </button>
            ))}
            <button type="button" onClick={() => onRunPodAction("restart")}>
              <RotateCw size={15} />
              Restart
            </button>
            <button className="danger" type="button" onClick={() => onRunPodAction("delete")}>
              <Skull size={15} />
              Kill
            </button>
          </div>
        </>
      ) : null}

      {result ? <ActionResult resource={resource} result={result} onConfirm={() => onRunPodAction(result.action, true)} /> : null}

      {isPod ? (
        <>
          <PodEventRail details={details} detailsError={detailsError} detailsLoading={detailsLoading} />
          <PodTerminal
            details={details}
            detailsError={detailsError}
            detailsLoading={detailsLoading}
            modeRequestId={terminalModeRequest.id}
            panelRef={terminalRef}
            preferredMode={terminalModeRequest.mode}
          />
        </>
      ) : (
        <>
          {resource.kind === "Event" ? (
            <EventSignalRail
              allResources={allResources}
              details={details}
              detailsError={detailsError}
              detailsLoading={detailsLoading}
              resource={resource}
              onOpenResource={onOpenResource}
            />
          ) : null}
          <RouteBackendRail resource={resource} resources={allResources} onOpenResource={onOpenResource} />
          <ServiceBackendRail resource={resource} resources={allResources} onOpenResource={onOpenResource} />
          <StorageBindingRail resource={resource} resources={allResources} onOpenResource={onOpenResource} />
          <WorkloadPodRail resource={resource} resources={allResources} onOpenResource={onOpenResource} />
          <HierarchyGroups groups={hierarchyGroups} onOpenResource={onOpenResource} />
        </>
      )}
    </section>
  );
}

function PodStatusPanel({ details, resource }: { details: ResourceDetails; resource: ResourceRow }) {
  const pod = details.pod;
  const containers = pod?.containers ?? [];
  const ready = pod ? `${pod.readyContainers}/${pod.totalContainers || containers.length}` : "syncing";
  const readyTone = !pod || pod.totalContainers === 0
    ? "syncing"
    : pod.readyContainers === pod.totalContainers
      ? "healthy"
      : "warning";
  const restartTotal = containers.length
    ? containers.reduce((sum, container) => sum + container.restartCount, 0)
    : resource.restarts;
  const diagnostic = podDiagnostic(pod);

  return (
    <section className="pod-debug-panel" aria-label="Pod runtime status">
      <div className="pod-status-line">
        <div>
          <StatusDot state={resource.status} />
          <strong>{pod?.phase ?? resource.status}</strong>
          <span>{ready} containers ready</span>
        </div>
        <small>{resource.owner || "standalone pod"}</small>
      </div>

      {diagnostic ? <p className="pod-status-diagnostic" title={diagnostic}>{diagnostic}</p> : null}

      <PodRuntimeFacts details={details} resource={resource} />

      <div className="pod-vitals">
        <RuntimeTile icon={Activity} label="Phase" value={pod?.phase ?? resource.status} tone={resource.status} />
        <RuntimeTile icon={CheckCircle2} label="Ready" value={ready} tone={readyTone} />
        <RuntimeTile icon={RotateCw} label="Restarts" value={String(restartTotal)} tone={restartTotal > 0 ? "warning" : "healthy"} />
        <RuntimeTile icon={GitCommitHorizontal} label="Node" value={pod?.nodeName || "pending"} tone="syncing" />
      </div>

      {pod?.conditions.length ? (
        <div className="pod-condition-grid" aria-label="Pod conditions">
          {pod.conditions.map((condition) => (
            <ConditionCell condition={condition} key={condition.type} />
          ))}
        </div>
      ) : null}

      <div className="container-strip">
        {containers.length ? (
          containers.map((container) => <ContainerCard container={container} key={container.name} />)
        ) : (
          <div className="container-card muted">
            <Box size={15} />
            <span>Container status syncing</span>
          </div>
        )}
      </div>
    </section>
  );
}

function podDiagnostic(pod: ResourceDetails["pod"]) {
  if (!pod) {
    return "";
  }

  return [pod.reason, pod.message]
    .filter((part, index, parts) => part && part !== pod.phase && parts.indexOf(part) === index)
    .join(" / ");
}

function podPorts(details: ResourceDetails) {
  const ports = new Set<number>();
  for (const container of details.pod?.containers ?? []) {
    for (const port of container.ports) {
      if (Number.isInteger(port) && port > 0) {
        ports.add(port);
      }
    }
  }
  return Array.from(ports).sort((left, right) => left - right);
}

function PodRuntimeFacts({ details, resource }: { details: ResourceDetails; resource: ResourceRow }) {
  const pod = details.pod;
  const facts = [
    { label: "Node", value: pod?.nodeName || "pending" },
    { label: "Pod IP", value: pod?.podIp || "pending" },
    { label: "Host IP", value: pod?.hostIp || "pending" },
    { label: "QoS", value: pod?.qosClass || "unknown" },
    { label: "Started", value: formatStartTime(pod?.startTime) },
    { label: "Image", value: resource.image || "unknown" },
  ];

  return (
    <div className="pod-runtime-facts" aria-label="Pod runtime facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <span>{fact.label}</span>
          <strong title={fact.value}>{fact.value}</strong>
        </div>
      ))}
    </div>
  );
}

function formatStartTime(startTime?: string) {
  if (!startTime) {
    return "pending";
  }

  const timestamp = Date.parse(startTime);
  if (Number.isNaN(timestamp)) {
    return startTime;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function ConditionCell({ condition }: { condition: PodCondition }) {
  const state = conditionState(condition.status);
  const diagnostic = conditionDiagnostic(condition);

  return (
    <article className={`pod-condition ${state}`}>
      <StatusDot state={state} />
      <span title={condition.type}>{formatConditionType(condition.type)}</span>
      <strong>{condition.status}</strong>
      {diagnostic ? <small title={diagnostic}>{diagnostic}</small> : null}
    </article>
  );
}

function conditionDiagnostic(condition: PodCondition) {
  return [condition.reason, condition.message]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(" / ");
}

function formatConditionType(type: string) {
  return type.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function conditionState(status: string): HealthState {
  if (status === "True") {
    return "healthy";
  }
  if (status === "False") {
    return "warning";
  }
  return "syncing";
}

function RuntimeTile({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: typeof Activity;
  label: string;
  tone: "healthy" | "warning" | "critical" | "syncing" | string;
  value: string;
}) {
  return (
    <article className={`runtime-tile ${tone}`}>
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ContainerCard({ container }: { container: ContainerDetails }) {
  const currentState = containerCurrentState(container);
  const lastState = containerLastState(container);

  return (
    <article className={container.ready ? "container-card ready" : "container-card warn"}>
      <div>
        <StatusDot state={container.ready ? "healthy" : "warning"} />
        <strong>{container.name}</strong>
        <small className="container-role">{container.role}</small>
      </div>
      <div className="container-state-grid">
        <ContainerStateFact
          hint={currentStateTime(container)}
          label="Now"
          value={currentState}
          tone={container.ready ? "healthy" : "warning"}
        />
        {lastState ? (
          <ContainerStateFact
            hint={lastStateTime(container)}
            label="Last"
            value={lastState}
            tone="warning"
          />
        ) : null}
      </div>
      {container.message ? <small className="container-diagnostic" title={container.message}>{container.message}</small> : null}
      {container.image ? (
        <span className="container-image">
          <ImageIcon size={13} />
          <code title={container.image}>{container.image}</code>
        </span>
      ) : null}
      <ContainerResources container={container} />
      <ContainerProbes container={container} />
      {container.ports.length ? (
        <span className="container-ports" aria-label={`Ports ${container.ports.join(", ")}`}>
          {container.ports.map((port) => (
            <small key={port}>{port}</small>
          ))}
        </span>
      ) : null}
      <small>{container.restartCount} restarts</small>
    </article>
  );
}

function ContainerProbes({ container }: { container: ContainerDetails }) {
  const probes = container.probes ?? [];

  if (!probes.length) {
    return null;
  }

  return (
    <div className="container-probes" aria-label="Container probes">
      {probes.map((probe) => (
        <span key={probe.kind} title={`${probe.kind}: ${probe.check}`}>
          <small>{probe.kind}</small>
          <em>{probe.check}</em>
        </span>
      ))}
    </div>
  );
}

function ContainerResources({ container }: { container: ContainerDetails }) {
  const requests = resourceEntries(container.requests);
  const limits = resourceEntries(container.limits);

  if (!requests.length && !limits.length) {
    return null;
  }

  return (
    <div className="container-resources" aria-label="Container resources">
      {requests.length ? <ResourceQuantityRow label="Req" entries={requests} /> : null}
      {limits.length ? <ResourceQuantityRow label="Lim" entries={limits} /> : null}
    </div>
  );
}

function ResourceQuantityRow({ entries, label }: { entries: [string, string][]; label: string }) {
  return (
    <span>
      <small>{label}</small>
      {entries.map(([name, value]) => (
        <em key={name} title={`${name}: ${value}`}>
          {resourceName(name)} {value}
        </em>
      ))}
    </span>
  );
}

function resourceEntries(resources: Record<string, string>) {
  const priority = new Map([
    ["cpu", 0],
    ["memory", 1],
  ]);

  return Object.entries(resources)
    .filter(([, value]) => value)
    .sort(([left], [right]) => (priority.get(left) ?? 10) - (priority.get(right) ?? 10) || left.localeCompare(right))
    .slice(0, 4);
}

function resourceName(name: string) {
  if (name === "memory") {
    return "mem";
  }
  return name.includes("/") ? name.split("/").pop() ?? name : name;
}

function ContainerStateFact({
  hint,
  label,
  tone,
  value,
}: {
  hint?: string;
  label: string;
  tone: "healthy" | "warning";
  value: string;
}) {
  return (
    <span className={`container-state ${tone}`}>
      <small>{label}</small>
      <strong title={value}>{value}</strong>
      {hint ? <time title={hint}>{hint}</time> : null}
    </span>
  );
}

function ActionResult({
  onConfirm,
  resource,
  result,
}: {
  onConfirm: () => void;
  resource: ResourceRow;
  result: PodActionResult;
}) {
  const risk = actionRisk(result.action);
  const StatusIcon = result.status === "executed" ? CheckCircle2 : ShieldAlert;

  return (
    <section className={`pod-action-result ${result.status} ${risk}`} aria-label="Pod action clearance">
      <div className="pod-action-status">
        <StatusIcon size={17} />
        <div>
          <span>{actionTitle(result.action)}</span>
          <strong>{statusTitle(result.status)}</strong>
        </div>
        <small>{risk} risk</small>
      </div>
      <div className="pod-action-body">
        <p>{actionMessage(result)}</p>
        <div className="pod-action-target" aria-label="Pod action target">
          <ActionFact label="Context" value={resource.cluster || "current"} />
          <ActionFact label="Namespace" value={resource.namespace} />
          <ActionFact label="Pod" value={resource.name} />
          <ActionFact label="Gate" value={result.requiresConfirmation ? "Confirm required" : statusTitle(result.status)} />
        </div>
        {result.command ? (
          <div className="pod-action-command">
            <span>Command</span>
            <code>{result.command}</code>
          </div>
        ) : null}
        {result.output ? <pre className="pod-action-output">{result.output}</pre> : null}
        {result.requiresConfirmation ? (
          <button type="button" onClick={onConfirm}>
            Confirm {actionTitle(result.action)}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ActionFact({ label, value }: { label: string; value: string }) {
  return (
    <small>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </small>
  );
}

function actionTitle(action: string) {
  const [base, detail] = action.split(":", 2);
  return detail ? `${base.replace(/-/g, " ")} ${detail}` : base.replace(/-/g, " ");
}

function statusTitle(status: PodActionResult["status"]) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function actionMessage(result: PodActionResult) {
  if (result.requiresConfirmation) {
    return "Confirmation required before running this command.";
  }
  return result.message;
}

function actionRisk(action: string) {
  const [base] = action.split(":", 1);
  if (base === "delete" || base === "kill") {
    return "high";
  }
  if (base === "restart" || base === "exec" || base === "port-forward") {
    return "medium";
  }
  return "low";
}

function EventSignalRail({
  allResources,
  details,
  detailsError,
  detailsLoading,
  onOpenResource,
  resource,
}: {
  allResources: ResourceRow[];
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
  onOpenResource: (id: string) => void;
  resource: ResourceRow;
}) {
  const event = details.events[0];
  const target = referencedResources(resource.references, allResources)[0];
  const type = detailsLoading ? "Syncing" : event?.type || resource.image || "Event";
  const reason = detailsLoading ? "Loading" : event?.reason || resource.diagnostic || "Event";
  const message = detailsLoading
    ? "Loading selected event."
    : event?.message || detailsError || resource.diagnostic || "No event message returned.";
  const count = event ? String(event.count) : "1";
  const age = event?.age || resource.age;
  const tone = type.toLowerCase() === "warning" || resource.status === "warning" ? "warning" : resource.status;

  return (
    <section className={`event-signal-rail ${tone}`} aria-label="Event signal">
      <header>
        <StatusDot state={tone} />
        <div>
          <span>{type}</span>
          <strong title={reason}>{reason}</strong>
        </div>
        <small>{count}x</small>
      </header>
      <div>
        <p title={message}>{message}</p>
        <div className="event-signal-facts">
          <ActionFact label="Age" value={age || "live"} />
          <ActionFact label="Namespace" value={resource.namespace} />
          <ActionFact label="Target" value={resource.owner || "unknown"} />
        </div>
        {target ? (
          <button type="button" onClick={() => onOpenResource(target.id)}>
            <Network size={15} />
            Open {target.kind}
          </button>
        ) : null}
      </div>
    </section>
  );
}

type HierarchyGroup = {
  title: string;
  resources: ResourceRow[];
};

function WorkloadPodRail({
  onOpenResource,
  resource,
  resources,
}: {
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
}) {
  const pods = useMemo(() => workloadPodsFor(resource, resources).sort(compareRuntimePods), [resource, resources]);

  if (!workloadKinds.has(resource.kind)) {
    return null;
  }

  const readyCount = pods.filter((pod) => pod.status === "healthy").length;
  const restartCount = pods.reduce((sum, pod) => sum + pod.restarts, 0);
  const visiblePods = pods.slice(0, 4);

  return (
    <section className="workload-pod-rail" aria-label="Workload pod runtime">
      <header>
        <span>Runtime pods</span>
        <strong>{readyCount}/{pods.length || 0} ready</strong>
        <small>{restartCount} restarts</small>
      </header>
      <div>
        {visiblePods.length ? (
          visiblePods.map((pod) => (
            <LinkedPodTile key={pod.id} meta={pod.nodeName || pod.namespace} pod={pod} onOpenResource={onOpenResource} />
          ))
        ) : (
          <div className="workload-pod-empty">
            <span>No owned pods</span>
            <strong>Selectors have no live pod match.</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function ServiceBackendRail({
  onOpenResource,
  resource,
  resources,
}: {
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
}) {
  const selector = useMemo(() => Object.entries(resource.selector), [resource.selector]);
  const pods = useMemo(() => serviceBackendPodsFor(resource, resources).sort(compareRuntimePods), [resource, resources]);
  const endpointSlices = useMemo(() => serviceEndpointSlicesFor(resource, resources).sort(compareEndpointSlices), [resource, resources]);
  const visiblePods = pods.slice(0, 5);
  const visibleEndpointSlices = endpointSlices.slice(0, 5);
  const readyCount = pods.filter((pod) => pod.backendReady).length;
  const readyEndpointSlices = endpointSlices.filter((slice) => slice.status === "healthy").length;
  const tone = serviceBackendTone(resource, selector.length, pods.length, readyCount, endpointSlices.length, readyEndpointSlices);

  if (resource.kind !== "Service") {
    return null;
  }

  return (
    <section className={`workload-pod-rail service-backend-rail ${tone}`} aria-label="Service backend pods">
      <header>
        <span>
          <Network size={15} />
          Backends
        </span>
        <strong>{serviceBackendReadout(selector.length, pods.length, readyCount, endpointSlices.length, readyEndpointSlices)}</strong>
        <small>{selector.length ? selectorSummary(selector) : resource.diagnostic || "external endpoints"}</small>
      </header>
      <div>
        {visiblePods.length ? (
          visiblePods.map((pod) => (
            <LinkedPodTile
              key={pod.id}
              meta={pod.backendReady ? "ready" : "not ready"}
              pod={pod}
              onOpenResource={onOpenResource}
            />
          ))
        ) : visibleEndpointSlices.length ? (
          visibleEndpointSlices.map((slice) => (
            <LinkedEndpointSliceTile endpointSlice={slice} key={slice.id} onOpenResource={onOpenResource} />
          ))
        ) : (
          <div className="service-backend-empty">
            <span>{selector.length ? "No pods matched" : "No endpoint slices"}</span>
            <strong>{selector.length ? "Traffic has no live pod target." : "EndpointSlice discovery has no live target."}</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function LinkedEndpointSliceTile({
  endpointSlice,
  onOpenResource,
}: {
  endpointSlice: ResourceRow;
  onOpenResource: (id: string, intent?: "logs" | null) => void;
}) {
  return (
    <button className={endpointSlice.status} type="button" onClick={() => onOpenResource(endpointSlice.id)}>
      <StatusDot state={endpointSlice.status} />
      <strong title={endpointSlice.name}>{endpointSlice.name}</strong>
      <em title={endpointSlice.diagnostic || endpointSlice.status}>{endpointSlice.diagnostic || endpointSlice.status}</em>
      <small title={endpointSlice.image || endpointSlice.namespace}>{endpointSlice.image || endpointSlice.namespace}</small>
      <small>{endpointSlice.age}</small>
    </button>
  );
}

function LinkedPodTile({
  meta,
  onOpenResource,
  pod,
}: {
  meta: string;
  onOpenResource: (id: string, intent?: "logs" | null) => void;
  pod: ResourceRow;
}) {
  return (
    <article className={`workload-pod-tile ${pod.status}`}>
      <button className="workload-pod-open" type="button" onClick={() => onOpenResource(pod.id)}>
        <StatusDot state={pod.status} />
        <strong title={pod.name}>{pod.name}</strong>
        <em title={pod.diagnostic || pod.status}>{pod.diagnostic || pod.status}</em>
        <small title={meta}>{meta}</small>
        <small>{pod.restarts}r</small>
      </button>
      <button
        aria-label={`Open logs for ${pod.name}`}
        className="workload-pod-log"
        title="Open logs"
        type="button"
        onClick={() => onOpenResource(pod.id, "logs")}
      >
        <FileText size={13} />
      </button>
    </article>
  );
}

function RouteBackendRail({
  onOpenResource,
  resource,
  resources,
}: {
  onOpenResource: (id: string) => void;
  resource: ResourceRow;
  resources: ResourceRow[];
}) {
  const serviceReferenceCount = resource.references.filter((reference) => reference.kind === "Service").length;
  const backends = useMemo(() => routeBackendsFor(resource, resources), [resource, resources]);
  const visibleBackends = backends.slice(0, 5);
  const tone = routeBackendTone(serviceReferenceCount, backends.map((backend) => backend.tone));

  if (!routeKinds.has(resource.kind)) {
    return null;
  }

  return (
    <section className={`workload-pod-rail service-backend-rail route-backend-rail ${tone}`} aria-label="Route backend services">
      <header>
        <span>
          <Network size={15} />
          Backends
        </span>
        <strong>{serviceReferenceCount ? `${backends.length}/${serviceReferenceCount} services` : "No refs"}</strong>
        <small>{routeBackendSummary(resource, backends.length)}</small>
      </header>
      <div>
        {visibleBackends.length ? (
          visibleBackends.map((backend) => (
            <button
              className={backend.tone}
              key={backend.service.id}
              type="button"
              onClick={() => onOpenResource(backend.service.id)}
            >
              <StatusDot state={backend.tone} />
              <strong title={backend.service.name}>{backend.service.name}</strong>
              <em title={backend.service.diagnostic || backend.summary}>
                {backend.service.diagnostic || backend.summary}
              </em>
              <small title={backend.service.namespace}>{backend.service.namespace}</small>
              <small>{backend.service.owner || "svc"}</small>
            </button>
          ))
        ) : (
          <div className="service-backend-empty">
            <span>{serviceReferenceCount ? "Services not found" : "No service refs"}</span>
            <strong>{serviceReferenceCount ? "Referenced services are missing from the live snapshot." : "Route has no Service backend reference."}</strong>
          </div>
        )}
      </div>
    </section>
  );
}

function routeBackendsFor(resource: ResourceRow, resources: ResourceRow[]) {
  return routeBackendServicesFor(resource, resources)
    .sort(compareRouteBackends)
    .map((service) => {
      const pods = backendPodsForServices([service], resources);
      const selectorCount = Object.keys(service.selector).length;
      const readyCount = pods.filter((pod) => pod.backendReady).length;
      const endpointSlices = serviceEndpointSlicesFor(service, resources);
      const readyEndpointSlices = endpointSlices.filter((slice) => slice.status === "healthy").length;
      const tone = serviceBackendTone(
        service,
        selectorCount,
        pods.length,
        readyCount,
        endpointSlices.length,
        readyEndpointSlices,
      );

      return {
        service,
        summary: serviceBackendReadout(selectorCount, pods.length, readyCount, endpointSlices.length, readyEndpointSlices),
        tone,
      };
    });
}

function workloadPodsFor(resource: ResourceRow, resources: ResourceRow[]) {
  if (!workloadKinds.has(resource.kind)) {
    return [];
  }

  return resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace && ownsPod(resource, item));
}

function serviceBackendPodsFor(resource: ResourceRow, resources: ResourceRow[]) {
  if (resource.kind !== "Service" || !Object.keys(resource.selector).length) {
    return [];
  }

  return resources.filter(
    (item) => item.kind === "Pod" && item.namespace === resource.namespace && matchesSelector(item, resource.selector),
  );
}

function serviceEndpointSlicesFor(resource: ResourceRow, resources: ResourceRow[]) {
  if (resource.kind !== "Service") {
    return [];
  }

  return resources.filter((item) => item.kind === "EndpointSlice" && referencesResource(item, resource));
}

function routeBackendServicesFor(resource: ResourceRow, resources: ResourceRow[]) {
  if (!routeKinds.has(resource.kind)) {
    return [];
  }

  return referencedResources(resource.references, resources).filter((item) => item.kind === "Service");
}

function serviceBackendTone(
  service: ResourceRow,
  selectorCount: number,
  podCount: number,
  readyCount: number,
  endpointSliceCount: number,
  readyEndpointSlices: number,
): HealthState {
  if (service.status !== "healthy") {
    return service.status;
  }
  if (!selectorCount) {
    return endpointSliceTone(service, endpointSliceCount, readyEndpointSlices);
  }
  if (!podCount || readyCount === 0) {
    return "critical";
  }
  return readyCount === podCount ? "healthy" : "warning";
}

function endpointSliceTone(service: ResourceRow, endpointSliceCount: number, readyEndpointSlices: number): HealthState {
  if (!endpointSliceCount) {
    return service.image === "ExternalName" ? "syncing" : "critical";
  }
  if (readyEndpointSlices === 0) {
    return "critical";
  }
  return readyEndpointSlices === endpointSliceCount ? "healthy" : "warning";
}

function serviceBackendReadout(
  selectorCount: number,
  podCount: number,
  readyCount: number,
  endpointSliceCount: number,
  readyEndpointSlices: number,
) {
  if (selectorCount) {
    return `${readyCount}/${podCount} ready`;
  }
  if (endpointSliceCount) {
    return `${readyEndpointSlices}/${endpointSliceCount} slices`;
  }
  return "No endpoints";
}

function routeBackendTone(referenceCount: number, tones: HealthState[]): HealthState {
  if (!referenceCount) {
    return "syncing";
  }
  if (!tones.length || tones.includes("critical")) {
    return "critical";
  }
  if (tones.includes("warning")) {
    return "warning";
  }
  if (tones.every((tone) => tone === "syncing")) {
    return "syncing";
  }
  return "healthy";
}

function routeBackendSummary(resource: ResourceRow, serviceCount: number) {
  if (resource.kind === "HTTPRoute" && resource.owner) {
    return `parents ${resource.owner}`;
  }
  if (resource.owner && resource.owner !== resource.namespace) {
    return resource.owner;
  }
  return serviceCount ? `${serviceCount} linked` : "unresolved";
}

function selectorSummary(selector: [string, string][]) {
  if (!selector.length) {
    return "external endpoints";
  }

  const visible = selector
    .slice(0, 2)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");

  return selector.length > 2 ? `${visible} +${selector.length - 2}` : visible;
}

function compareRuntimePods(left: ResourceRow, right: ResourceRow) {
  return podRuntimeRank(left) - podRuntimeRank(right) ||
    right.restarts - left.restarts ||
    left.name.localeCompare(right.name);
}

function compareEndpointSlices(left: ResourceRow, right: ResourceRow) {
  return podRuntimeRank(left) - podRuntimeRank(right) ||
    left.name.localeCompare(right.name);
}

function compareRouteBackends(left: ResourceRow, right: ResourceRow) {
  return podRuntimeRank(left) - podRuntimeRank(right) ||
    left.namespace.localeCompare(right.namespace) ||
    left.name.localeCompare(right.name);
}

function podRuntimeRank(pod: ResourceRow) {
  switch (pod.status) {
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

function HierarchyGroups({
  groups,
  onOpenResource,
}: {
  groups: HierarchyGroup[];
  onOpenResource: (id: string) => void;
}) {
  const visibleGroups = useMemo(() => groups.filter((group) => group.title), [groups]);
  const groupSignature = useMemo(
    () => visibleGroups.map((group) => `${group.title}:${group.resources.length}`).join("|"),
    [visibleGroups],
  );
  const firstGroupTitle = visibleGroups[0]?.title ?? "";
  const [activeTitle, setActiveTitle] = useState("");
  const activeGroup = visibleGroups.find((group) => group.title === activeTitle) ?? visibleGroups[0];

  useEffect(() => {
    setActiveTitle(firstGroupTitle);
  }, [firstGroupTitle, groupSignature]);

  if (!visibleGroups.length) {
    return (
      <div className="empty-state">
        <strong>No child resources found</strong>
        <span>This object has no obvious runtime hierarchy yet.</span>
      </div>
    );
  }

  return (
    <section className="hierarchy-groups">
      {visibleGroups.length > 1 ? (
        <div className="hierarchy-tabs" role="tablist" aria-label="Related resource groups">
          {visibleGroups.map((group) => (
            <button
              aria-selected={group.title === activeGroup.title}
              className={group.title === activeGroup.title ? "active" : ""}
              key={group.title}
              role="tab"
              type="button"
              onClick={() => setActiveTitle(group.title)}
            >
              <span>{group.title}</span>
              <strong>{group.resources.length}</strong>
            </button>
          ))}
        </div>
      ) : null}

      <section className="hierarchy-group" key={activeGroup.title}>
          <header>
            <span>{activeGroup.title}</span>
            <strong>{activeGroup.resources.length}</strong>
          </header>
          <div className="hierarchy-table">
            {activeGroup.resources.length ? (
              activeGroup.resources.map((child) => (
                <button key={child.id} type="button" onClick={() => onOpenResource(child.id)}>
                  <span className="name-cell">
                    <StatusDot state={child.status} />
                    <strong>{child.name}</strong>
                  </span>
                  <span>{child.kind}</span>
                  <span>{child.age}</span>
                </button>
              ))
            ) : (
              <div className="hierarchy-empty">
                <strong>No {activeGroup.title.toLowerCase()}</strong>
                <span>This object has no live resources in this relationship.</span>
              </div>
            )}
          </div>
      </section>
    </section>
  );
}

const trafficKinds = new Set(["Service", "EndpointSlice", "Ingress", "Gateway", "HTTPRoute"]);
const routeKinds = new Set(["Ingress", "HTTPRoute"]);
const inputDependencyKinds = new Set(["ConfigMap", "Secret", "PersistentVolumeClaim"]);
const configKinds = new Set(["ConfigMap", "Secret", "Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"]);
const accessKinds = new Set(["Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"]);
const storageKinds = new Set(["PersistentVolumeClaim", "PersistentVolume", "StorageClass"]);

function hierarchyFor(resource: ResourceRow, resources: ResourceRow[]): HierarchyGroup[] {
  if (resource.kind === "Event") {
    return [
      { title: "Involved object", resources: referencedResources(resource.references, resources) },
      { title: "Namespace", resources: resources.filter((item) => item.kind === "Namespace" && item.name === resource.namespace) },
    ];
  }

  if (resource.kind === "Namespace") {
    const scoped = resources.filter((item) => item.namespace === resource.name && item.id !== resource.id);
    return [
      { title: "Workloads", resources: scoped.filter((item) => workloadKinds.has(item.kind)) },
      { title: "Services and routes", resources: scoped.filter((item) => trafficKinds.has(item.kind)) },
      { title: "Pods", resources: scoped.filter((item) => item.kind === "Pod") },
      { title: "Config and access", resources: scoped.filter((item) => configKinds.has(item.kind)) },
      { title: "Storage", resources: scoped.filter((item) => storageKinds.has(item.kind)) },
      { title: "Packages", resources: scoped.filter((item) => item.kind === "HelmRelease") },
    ];
  }

  if (resource.kind === "Node") {
    const pods = resources.filter((item) => item.kind === "Pod" && item.nodeName === resource.name);
    return [
      { title: "Scheduled pods", resources: pods },
    ];
  }

  if (resource.kind === "Service") {
    const namespacePods = resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace);
    const selectedPods = namespacePods.filter((item) => matchesSelector(item, resource.selector));
    const hasSelector = Object.keys(resource.selector).length > 0;
    const pods = hasSelector ? selectedPods : namespacePods;
    const routes = resources.filter((item) => routeKinds.has(item.kind) && referencesResource(item, resource));
    const endpointSlices = resources.filter((item) => item.kind === "EndpointSlice" && referencesResource(item, resource));
    return [
      { title: hasSelector ? "Selected pods" : "Pods in namespace", resources: pods },
      { title: "EndpointSlices", resources: endpointSlices },
      { title: "Workloads in namespace", resources: workloadsForPods(pods, resources) },
      { title: "Routes", resources: routes },
      { title: "Config nearby", resources: resources.filter((item) => item.namespace === resource.namespace && ["ConfigMap", "Secret", "HelmRelease"].includes(item.kind)) },
    ];
  }

  if (workloadKinds.has(resource.kind)) {
    const pods = resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace && ownsPod(resource, item));
    const services = resources.filter(
      (item) =>
        item.kind === "Service" &&
        item.namespace === resource.namespace &&
        (matchesSelector(resource, item.selector) || pods.some((pod) => matchesSelector(pod, item.selector))),
    );
    return [
      { title: "Pods", resources: pods },
      { title: "Services", resources: services },
      { title: "Config nearby", resources: resources.filter((item) => item.namespace === resource.namespace && ["ConfigMap", "Secret"].includes(item.kind)) },
    ];
  }

  if (inputDependencyKinds.has(resource.kind)) {
    return inputDependencyHierarchyFor(resource, resources);
  }

  if (accessKinds.has(resource.kind)) {
    return accessHierarchyFor(resource, resources);
  }

  if (routeKinds.has(resource.kind)) {
    const services = referencedResources(resource.references, resources).filter((item) => item.kind === "Service");
    const pods = backendPodsForServices(services, resources);

    return [
      { title: "Backend services", resources: services },
      ...(pods.length ? [{ title: "Backend pods", resources: pods }] : []),
    ];
  }

  if (resource.kind === "EndpointSlice") {
    return [
      { title: "Service", resources: referencedResources(resource.references, resources).filter((item) => item.kind === "Service") },
      { title: "Endpoint pods", resources: referencedResources(resource.references, resources).filter((item) => item.kind === "Pod") },
    ];
  }

  if (resource.kind === "Gateway") {
    return [
      { title: "Routes", resources: resources.filter((item) => item.kind === "HTTPRoute" && routeParents(item).includes(resource.name)) },
    ];
  }

  return [
    { title: "Pods in namespace", resources: resources.filter((item) => item.kind === "Pod" && item.namespace === resource.namespace) },
    { title: "Workloads in namespace", resources: resources.filter((item) => item.namespace === resource.namespace && workloadKinds.has(item.kind)) },
  ];
}

function accessHierarchyFor(resource: ResourceRow, resources: ResourceRow[]): HierarchyGroup[] {
  if (resource.kind === "Role") {
    return [
      { title: "Bindings", resources: accessBindingsFor("Role", resource.name, resource.namespace, resources) },
      { title: "Namespace access", resources: namespaceAccess(resource, resources) },
    ];
  }

  if (resource.kind === "ClusterRole") {
    return [
      { title: "Cluster bindings", resources: accessBindingsFor("ClusterRole", resource.name, "cluster", resources) },
      { title: "Namespace bindings", resources: accessBindingsFor("ClusterRole", resource.name, "", resources) },
    ];
  }

  if (resource.kind === "RoleBinding" || resource.kind === "ClusterRoleBinding") {
    const [roleKind, roleName] = roleReference(resource.owner);
    return [
      { title: "Referenced role", resources: referencedRole(resource, roleKind, roleName, resources) },
      { title: "Sibling bindings", resources: siblingBindings(resource, resources) },
    ];
  }

  return [];
}

function inputDependencyHierarchyFor(resource: ResourceRow, resources: ResourceRow[]): HierarchyGroup[] {
  const consumingPods = resources.filter((item) => item.kind === "Pod" && referencesResource(item, resource));
  const workloads = workloadsForPods(consumingPods, resources);

  return [
    { title: "Consuming pods", resources: consumingPods },
    ...(workloads.length ? [{ title: "Owning workloads", resources: workloads }] : []),
  ];
}

function accessBindingsFor(kind: string, name: string, namespace: string, resources: ResourceRow[]) {
  const owner = `${kind}/${name}`;
  return resources.filter((item) => {
    if (item.owner !== owner) {
      return false;
    }
    if (namespace === "cluster") {
      return item.kind === "ClusterRoleBinding";
    }
    if (namespace) {
      return item.kind === "RoleBinding" && item.namespace === namespace;
    }
    return item.kind === "RoleBinding";
  });
}

function namespaceAccess(resource: ResourceRow, resources: ResourceRow[]) {
  return resources.filter(
    (item) => item.id !== resource.id && item.namespace === resource.namespace && accessKinds.has(item.kind),
  );
}

function referencedRole(resource: ResourceRow, roleKind: string, roleName: string, resources: ResourceRow[]) {
  if (!roleKind || !roleName) {
    return [];
  }

  return resources.filter((item) => {
    if (item.kind !== roleKind || item.name !== roleName) {
      return false;
    }
    return roleKind === "ClusterRole" || item.namespace === resource.namespace;
  });
}

function siblingBindings(resource: ResourceRow, resources: ResourceRow[]) {
  return resources.filter(
    (item) => item.id !== resource.id && item.kind === resource.kind && item.owner === resource.owner,
  );
}

function roleReference(owner: string) {
  const [kind = "", name = ""] = owner.split("/", 2);
  return [kind, name] as const;
}

function workloadsForPods(pods: ResourceRow[], resources: ResourceRow[]) {
  return resources.filter((item) => workloadKinds.has(item.kind) && pods.some((pod) => ownsPod(item, pod)));
}

function backendPodsForServices(services: ResourceRow[], resources: ResourceRow[]) {
  return resources.filter((item) =>
    item.kind === "Pod" &&
    services.some((service) => item.namespace === service.namespace && matchesSelector(item, service.selector)),
  );
}

function routeParents(route: ResourceRow) {
  return route.owner.split(",").map((parent) => parent.trim()).filter(Boolean);
}

function referencedResources(references: ResourceRow["references"], resources: ResourceRow[]) {
  return resources.filter((resource) =>
    references.some((reference) =>
      resource.kind === reference.kind &&
      resource.name === reference.name &&
      (reference.namespace === "cluster" || resource.namespace === reference.namespace),
    ),
  );
}
