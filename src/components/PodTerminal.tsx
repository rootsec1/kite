import { useDeferredValue, useMemo, useState } from "react";
import { ListFilter, Rows3, Search } from "lucide-react";
import type { ResourceDetails } from "../types/kube";

const ansiPattern = /\u001b\[[0-9;]*m/g;
const logPrefixPattern = /^\[?([^\]\s]+\/[^\]\s]+(?:\/[^\]\s]+)?)\]?\s+(.*)$/;
const leadingTimestampPattern = /^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/;
const embeddedTimestampPattern = /(?:^|\s)(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/;
const logLevels = ["all", "info", "warn", "error", "debug"] as const;

type LogLevel = (typeof logLevels)[number];

type ParsedLogLine = {
  raw: string;
  time: string;
  source: string;
  level: Exclude<LogLevel, "all">;
  message: string;
};

export function PodTerminal({
  details,
  detailsError,
  detailsLoading,
}: {
  details: ResourceDetails;
  detailsError: string;
  detailsLoading: boolean;
}) {
  const [levelFilter, setLevelFilter] = useState<LogLevel>("all");
  const [logQuery, setLogQuery] = useState("");
  const [wrapLines, setWrapLines] = useState(true);
  const deferredLogQuery = useDeferredValue(logQuery.trim().toLowerCase());
  const queryTerms = useMemo(() => (deferredLogQuery ? deferredLogQuery.split(/\s+/) : []), [deferredLogQuery]);

  const logView = useMemo(() => {
    const lines = parseLogLines(terminalOutput(details, detailsLoading, detailsError));
    const counts = new Map<LogLevel, number>(logLevels.map((level) => [level, 0]));
    const visibleLines: ParsedLogLine[] = [];

    counts.set("all", lines.length);
    for (const line of lines) {
      counts.set(line.level, (counts.get(line.level) ?? 0) + 1);
      if (levelFilter !== "all" && line.level !== levelFilter) {
        continue;
      }
      if (queryTerms.length && !matchesLogQuery(line, queryTerms)) {
        continue;
      }
      visibleLines.push(line);
    }

    return { counts, lines, visibleLines };
  }, [details.logs, detailsError, detailsLoading, levelFilter, queryTerms]);

  return (
    <section className="terminal-panel">
      <header>
        <div>
          <span>Live tail</span>
          <strong>{detailsLoading ? "syncing" : `${logView.visibleLines.length}/${logView.lines.length} lines`}</strong>
        </div>
        <div className="log-meters" aria-label="Log signal summary">
          <span className="ok">stream</span>
          {(logView.counts.get("warn") ?? 0) > 0 ? <span className="warn">{logView.counts.get("warn")} warn</span> : null}
          {(logView.counts.get("error") ?? 0) > 0 ? <span className="error">{logView.counts.get("error")} error</span> : null}
        </div>
      </header>

      <div className="log-toolbar" aria-label="Log controls">
        <label className="log-search">
          <Search size={14} />
          <input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Filter logs..." />
        </label>
        <div className="log-level-tabs" role="tablist" aria-label="Log severity">
          <ListFilter size={14} />
          {logLevels.map((level) => (
            <button
              aria-selected={level === levelFilter}
              className={level === levelFilter ? "active" : ""}
              key={level}
              role="tab"
              type="button"
              onClick={() => setLevelFilter(level)}
            >
              <span>{level}</span>
              <strong>{logView.counts.get(level) ?? 0}</strong>
            </button>
          ))}
        </div>
        <button className={wrapLines ? "log-wrap active" : "log-wrap"} type="button" onClick={() => setWrapLines((current) => !current)}>
          <Rows3 size={14} />
          <span>Wrap</span>
        </button>
      </div>

      <div className="terminal-frame">
        <div className="terminal-chrome">
          <i />
          <i />
          <i />
          <span>kubectl logs --all-containers --prefix --tail=240</span>
        </div>
        <div className={wrapLines ? "terminal-output" : "terminal-output no-wrap"} role="log" aria-live="polite">
          {logView.visibleLines.length ? (
            logView.visibleLines.map((line, index) => (
              <div className={`log-line ${line.level}`} key={`${line.raw}-${index}`}>
                <span className="log-number">{index + 1}</span>
                <time>{line.time}</time>
                <span className="log-source">{line.source}</span>
                <span className="log-level">{line.level}</span>
                <code>{line.message}</code>
              </div>
            ))
          ) : (
            <div className="log-empty">
              <strong>No matching log lines</strong>
              <span>Clear the filter or switch severity.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function terminalOutput(details: ResourceDetails, detailsLoading: boolean, detailsError: string) {
  if (detailsLoading && !details.logs) {
    return "Connecting to pod log stream...";
  }
  return details.logs || detailsError || "No log lines returned yet.";
}

function parseLogLines(output: string): ParsedLogLine[] {
  return output.split(/\r?\n/).filter(Boolean).map((raw) => {
    const clean = raw.replace(ansiPattern, "");
    const prefixMatch = clean.match(logPrefixPattern);
    const source = compactLogSource(prefixMatch?.[1] ?? "pod");
    const body = prefixMatch?.[2] ?? clean;
    const timeMatch = body.match(leadingTimestampPattern) ?? body.match(embeddedTimestampPattern);
    const time = timeMatch?.[1] ? formatLogTime(timeMatch[1]) : "";
    const message = timeMatch?.[2] ?? body;
    const lower = message.toLowerCase();
    const level = lower.includes("error") || lower.includes("exception") || lower.includes("fatal")
      ? "error"
      : lower.includes("warn")
        ? "warn"
        : lower.includes("debug")
          ? "debug"
          : "info";

    return {
      raw,
      time,
      source,
      level,
      message,
    };
  });
}

function matchesLogQuery(line: ParsedLogLine, terms: string[]) {
  const haystack = `${line.time} ${line.source} ${line.level} ${line.message}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function compactLogSource(source: string) {
  const parts = source.replace(/^\[/, "").replace(/\]$/, "").split("/");
  return parts.length >= 3 ? `${parts.at(-2)}/${parts.at(-1)}` : source;
}

function formatLogTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace("T", " ").replace("Z", "");
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
