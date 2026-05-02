import type { ContainerDetails, HealthState } from "../types/kube";

const criticalLifecyclePattern = /(crashloop|imagepull|errimage|invalidimage|oomkilled|runcontainer|createcontainer|failed|error|exit)/i;

export function containerCurrentState(container: ContainerDetails) {
  const parts = [
    container.state,
    container.reason,
    container.exitCode == null ? "" : `exit ${container.exitCode}`,
  ].filter(Boolean);

  return parts.join(" / ");
}

export function containerLastState(container: ContainerDetails) {
  const parts = [
    container.lastReason,
    container.lastExitCode == null ? "" : `exit ${container.lastExitCode}`,
  ].filter(Boolean);

  return parts.join(" / ");
}

export function currentStateTime(container: ContainerDetails) {
  if (container.startedAt) {
    return `since ${formatLifecycleTime(container.startedAt)}`;
  }
  if (container.finishedAt) {
    return `ended ${formatLifecycleTime(container.finishedAt)}`;
  }
  return "";
}

export function lastStateTime(container: ContainerDetails) {
  if (container.lastFinishedAt) {
    return `ended ${formatLifecycleTime(container.lastFinishedAt)}`;
  }
  if (container.lastStartedAt) {
    return `started ${formatLifecycleTime(container.lastStartedAt)}`;
  }
  return "";
}

export function containerLifecycleTone(container: ContainerDetails): Exclude<HealthState, "syncing"> {
  const diagnostic = [
    container.state,
    container.reason,
    container.message,
    container.lastReason,
    container.exitCode == null ? "" : `exit ${container.exitCode}`,
    container.lastExitCode == null ? "" : `exit ${container.lastExitCode}`,
  ].join(" ");

  if (!container.ready && criticalLifecyclePattern.test(diagnostic)) {
    return "critical";
  }
  if (!container.ready || container.restartCount > 0 || container.lastReason || container.lastExitCode != null) {
    return "warning";
  }
  return "healthy";
}

function formatLifecycleTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value.replace("T", " ").replace("Z", "");
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
