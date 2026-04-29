import { AlertTriangle, CheckCircle2, History, RotateCw, ShieldAlert } from "lucide-react";
import type { ContainerDetails, HealthState, ResourceDetails, ResourceRow } from "../types/kube";

type PodIssueSignal = {
  label: string;
  value: string;
  meta: string;
  tone: Exclude<HealthState, "syncing">;
  icon: "condition" | "event" | "history" | "ready" | "restart";
};

export function PodIssueStrip({ details, resource }: { details: ResourceDetails; resource: ResourceRow }) {
  const signals = podIssueSignals(details, resource);

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
          <article className={signal.tone} key={`${signal.label}-${signal.value}`}>
            <IssueIcon icon={signal.icon} />
            <span>{signal.label}</span>
            <strong title={signal.value}>{signal.value}</strong>
            <small title={signal.meta}>{signal.meta}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function podIssueSignals(details: ResourceDetails, resource: ResourceRow): PodIssueSignal[] {
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
      tone: "healthy",
      value: "captured",
    });
  }

  return signals.slice(0, 4);
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
    case "ready":
      return <CheckCircle2 size={15} />;
    case "restart":
      return <RotateCw size={15} />;
    case "condition":
    default:
      return <ShieldAlert size={15} />;
  }
}
