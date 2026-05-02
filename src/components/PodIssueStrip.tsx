import { Activity, AlertTriangle, CheckCircle2, History, RotateCw, ShieldAlert } from "lucide-react";
import type { ContainerDetails, ContainerProbe, HealthState, ResourceDetails, ResourceEvent, ResourceRow } from "../types/kube";

type PodIssueSignal = {
  label: string;
  value: string;
  meta: string;
  tone: Exclude<HealthState, "syncing">;
  icon: "condition" | "event" | "history" | "probe" | "ready" | "restart";
  onSelect?: () => void;
};

export function PodIssueStrip({
  details,
  onOpenPreviousLogs,
  resource,
}: {
  details: ResourceDetails;
  onOpenPreviousLogs?: () => void;
  resource: ResourceRow;
}) {
  const signals = podIssueSignals(details, resource, onOpenPreviousLogs);

  if (!signals.length) {
    return null;
  }

  return (
    <section className="pod-issue-strip" aria-label="Pod failure cues">
      <header>
        <span>Failure cues</span>
        <strong>{signals.length}</strong>
      </header>
      <div>
        {signals.map((signal) => (
          <IssueSignal signal={signal} key={`${signal.label}-${signal.value}`} />
        ))}
      </div>
    </section>
  );
}

function IssueSignal({ signal }: { signal: PodIssueSignal }) {
  const content = (
    <>
      <IssueIcon icon={signal.icon} />
      <span>{signal.label}</span>
      <strong title={signal.value}>{signal.value}</strong>
      <small title={signal.meta}>{signal.meta}</small>
    </>
  );

  if (signal.onSelect) {
    return (
      <button
        aria-label={`${signal.label}: ${signal.value}. Open previous logs.`}
        className={`${signal.tone} actionable`}
        type="button"
        onClick={signal.onSelect}
      >
        {content}
      </button>
    );
  }

  return <article className={signal.tone}>{content}</article>;
}

function podIssueSignals(details: ResourceDetails, resource: ResourceRow, onOpenPreviousLogs?: () => void): PodIssueSignal[] {
  const pod = details.pod;
  const containers = pod?.containers ?? [];
  const restartTotal = containers.length
    ? containers.reduce((sum, container) => sum + container.restartCount, 0)
    : resource.restarts;
  const notReadyContainers = containers.filter((container) => !container.ready);
  const lastExit = containers.find((container) => container.lastReason || container.lastExitCode != null);
  const warningCondition = pod?.conditions.find((condition) => condition.status !== "True");
  const warningEvents = details.events.filter((event) => event.type.toLowerCase() === "warning");
  const warningEventCount = warningEvents.reduce((sum, event) => sum + (Number.isFinite(event.count) && event.count > 0 ? event.count : 1), 0);
  const diagnostic = primaryDiagnostic(details, resource);
  const probeFailure = probeFailureSignal(details.events, containers.flatMap((container) => container.probes ?? []));
  const signals: PodIssueSignal[] = [];

  if (notReadyContainers.length) {
    signals.push({
      icon: "ready",
      label: "Ready",
      meta: containerNames(notReadyContainers),
      tone: "critical",
      value: `${Math.max(containers.length - notReadyContainers.length, 0)}/${containers.length || "?"}`,
    });
  }

  if (probeFailure) {
    signals.push(probeFailure);
  }

  if (restartTotal > 0) {
    signals.push({
      icon: "restart",
      label: "Restarts",
      meta: restartedContainerMeta(containers),
      tone: restartTotal >= 3 ? "warning" : "healthy",
      value: String(restartTotal),
    });
  }

  if (lastExit) {
    signals.push({
      icon: "history",
      label: "Last exit",
      meta: lastExit.name,
      tone: "warning",
      value: containerLastExit(lastExit),
    });
  }

  if (diagnostic) {
    signals.push({
      icon: "condition",
      label: "Diagnostic",
      meta: pod?.phase || resource.status,
      tone: diagnosticTone(resource.status),
      value: diagnostic,
    });
  } else if (warningCondition) {
    signals.push({
      icon: "condition",
      label: "Condition",
      meta: warningCondition.reason || warningCondition.message || "not true",
      tone: "warning",
      value: warningCondition.type,
    });
  }

  if (warningEventCount > 0) {
    signals.push({
      icon: "event",
      label: "Events",
      meta: warningEvents[0]?.reason || "warning",
      tone: "warning",
      value: `${warningEventCount} warning`,
    });
  }

  if (details.previousLogs.trim() && (restartTotal > 0 || lastExit)) {
    signals.push({
      icon: "history",
      label: "Previous logs",
      meta: "live tail switch",
      onSelect: onOpenPreviousLogs,
      tone: "healthy",
      value: "captured",
    });
  }

  return signals.slice(0, 4);
}

function probeFailureSignal(events: ResourceEvent[], probes: ContainerProbe[]): PodIssueSignal | null {
  const event = events.find(isProbeFailureEvent);
  if (!event) {
    return null;
  }

  const probeKind = probeFailureKind(event.message);
  const matchingProbe = probeKind ? probes.find((probe) => probe.kind === probeKind) : probes.length === 1 ? probes[0] : undefined;
  const displayKind = probeKind || matchingProbe?.kind || "";
  const count = Number.isFinite(event.count) && event.count > 1 ? `x${event.count}` : event.age || "warning";

  return {
    icon: "probe",
    label: "Probe",
    meta: matchingProbe?.check || event.reason || count,
    tone: "warning",
    value: displayKind ? `${displayKind} failed` : "probe failed",
  };
}

function isProbeFailureEvent(event: ResourceEvent) {
  return event.type.toLowerCase() === "warning" && (
    event.reason === "Unhealthy" ||
    /\b(readiness|liveness|startup)\s+probe\s+(failed|errored|error)\b/i.test(event.message)
  );
}

function probeFailureKind(message: string) {
  const match = message.match(/\b(readiness|liveness|startup)\s+probe\b/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function primaryDiagnostic(details: ResourceDetails, resource: ResourceRow) {
  const pod = details.pod;
  const parts = [pod?.reason, pod?.message, resource.diagnostic]
    .filter((part, index, list): part is string => Boolean(part) && list.indexOf(part) === index)
    .filter((part) => !/^\d+\s+restarts?$/i.test(part));

  return parts[0] ?? "";
}

function diagnosticTone(status: HealthState): PodIssueSignal["tone"] {
  return status === "critical" ? "critical" : "warning";
}

function restartedContainerMeta(containers: ContainerDetails[]) {
  const restarted = containers.filter((container) => container.restartCount > 0);
  if (!restarted.length) {
    return "resource signal";
  }
  return containerNames(restarted);
}

function containerNames(containers: ContainerDetails[]) {
  return containers.map((container) => container.name).join(", ");
}

function containerLastExit(container: ContainerDetails) {
  return [container.lastReason, container.lastExitCode == null ? "" : `exit ${container.lastExitCode}`]
    .filter(Boolean)
    .join(" / ");
}

function IssueIcon({ icon }: { icon: PodIssueSignal["icon"] }) {
  switch (icon) {
    case "event":
      return <AlertTriangle size={15} />;
    case "history":
      return <History size={15} />;
    case "probe":
      return <Activity size={15} />;
    case "ready":
      return <CheckCircle2 size={15} />;
    case "restart":
      return <RotateCw size={15} />;
    case "condition":
    default:
      return <ShieldAlert size={15} />;
  }
}
