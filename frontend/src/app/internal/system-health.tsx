"use client";

// The operator System health page (Cycle 5 P3.3; spec §10.1, A31-A33, A39) over
// `GET /api/internal/ops/health`. Rehaul engine only: the console shows its nav
// entry only when the deployment runs the rehaul engine.
//
// Five sections in the spec's order: Workers, Documents added in the last 24 hours,
// Waiting over one hour, Needs a person, Today's AI spend. The observation time is
// shown in UTC; the page refreshes every 30 s while the tab is visible and has a
// manual Refresh. Read-only by design: no restart, bulk or destructive action lives
// here (spec §10.1), with one exception (Ruling 93): a Delete file whose purge
// stopped has Retry delete, which only queues that purge again. Display rules are
// in `system-health-display.ts`.

import { MouseEvent, ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button as DesignButton } from "@/components/ui/button";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import type { NeedsPersonRow, OpsHealth } from "@/lib/ops-health";
import type { InternalApi } from "./internal-api";
import {
  DOCUMENT_COUNTS,
  INITIAL_HEALTH,
  NOT_AVAILABLE,
  accountingLabel,
  clientLabel,
  healthReducer,
  issueKey,
  issueMarker,
  linkedIssues,
  needsPersonLine,
  observedLabel,
  replacedSummary,
  retriesDelete,
  sectionUnavailable,
  spendGroups,
  spendLine,
  staleLabel,
  waitingLine,
  windowLabel,
  workersView,
  type ClientDirectory,
  type DetailSection,
  type HealthState,
  type Tone,
  type WorkerLine,
} from "./system-health-display";
import { HealthRefresher } from "./system-health-refresh";

/** Opens a client's section in the console (in-page: the passcode lives in memory). */
export type OpenClient = (clientId: string, section: DetailSection) => void;
/** Retry delete on a stuck Delete file row (Ruling 93); resolves once the purge is queued again. */
export type RetryDelete = (row: NeedsPersonRow) => Promise<void>;

export function SystemHealth({ api, clients, onOpenClient }: {
  api: InternalApi; clients: ClientDirectory; onOpenClient?: OpenClient;
}) {
  const [state, dispatch] = useReducer(healthReducer, INITIAL_HEALTH);
  const [reading, setReading] = useState(false);
  const refresher = useRef<HealthRefresher<OpsHealth> | null>(null);

  useEffect(() => {
    const current = new HealthRefresher<OpsHealth>({
      load: () => api<OpsHealth>("/api/internal/ops/health"),
      onLoaded: (data) => dispatch({ type: "loaded", data }),
      onFailed: (error) => dispatch({
        type: "failed", message: error instanceof Error ? error.message : "System health could not be read.",
      }),
      onReading: setReading,
      hidden: () => window.document.visibilityState === "hidden",
    });
    refresher.current = current;
    void current.refresh();
    const visibility = () => current.visibilityChanged();
    window.document.addEventListener("visibilitychange", visibility);
    return () => {
      current.stop();
      refresher.current = null;
      window.document.removeEventListener("visibilitychange", visibility);
    };
  }, [api]);

  async function retryDelete(row: NeedsPersonRow) {
    await api(
      `/api/internal/clients/${encodeURIComponent(row.client_id)}/sources/${encodeURIComponent(row.document_id ?? "")}/retry-delete`,
      { method: "POST" },
    );
    void refresher.current?.refresh(); // the row clears now that a purge job waits
  }

  return (
    <SystemHealthView
      state={state}
      reading={reading}
      clients={clients}
      onRefresh={() => void refresher.current?.refresh()}
      onOpenClient={onOpenClient}
      onRetryDelete={retryDelete}
    />
  );
}

/** Retry delete (Ruling 93): one click queues the stuck purge again; a refusal is shown on the row. */
function RetryDeleteButton({ row, onRetryDelete }: { row: NeedsPersonRow; onRetryDelete: RetryDelete }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await onRetryDelete(row);
      setNote({ tone: "ok", text: "Delete restarted. This row clears while it runs and stays gone once the file is deleted." });
    } catch (reason) {
      setNote({ tone: "bad", text: reason instanceof Error ? reason.message : "Retry delete did not go through. Try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="idc-health-retry" data-retry-delete={row.item_id}>
      <DesignButton variant="outline" size="sm" onClick={() => void retry()} disabled={busy}>
        {busy ? "Retrying…" : "Retry delete"}
      </DesignButton>
      {note ? <p role={note.tone === "bad" ? "alert" : "status"} className={`idc-note ${note.tone}`}>{note.text}</p> : null}
    </div>
  );
}

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`idc-badge ${tone}`}>{children}</span>;
}

function Unavailable({ text }: { text: string }) {
  return <p className="idc-health-unavailable" role="status">{text}</p>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="idc-health-fact"><dt>{label}</dt><dd>{value}</dd></div>;
}

/** A link to a client's section. A real href for the address; a plain click opens it
 *  in place, so the operator keeps the passcode they unlocked with. */
function ClientLink({ clientId, section, label, onOpenClient }: {
  clientId: string; section: DetailSection; label: string; onOpenClient?: OpenClient;
}) {
  const href = `/internal?client=${encodeURIComponent(clientId)}&module=${section}`;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (!onOpenClient || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpenClient(clientId, section);
  }
  return <a className="idc-health-link" href={href} onClick={open}>{label}</a>;
}

const anchor = (prefix: string, key: string) => `${prefix}-${key.replace(/[^a-zA-Z0-9-]/g, "-")}`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="idc-card idc-health-section" aria-labelledby={id} data-section={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function WorkerItem({ line }: { line: WorkerLine }) {
  return (
    <li className="idc-health-item" data-lane-warning={line.laneWarning ? "true" : undefined}>
      <div className="idc-health-item-top"><strong>{line.title}</strong><Badge tone={line.status.tone}>{line.status.label}</Badge></div>
      <dl className="idc-health-facts">
        <Fact label="Lanes" value={line.lanes} />
        <Fact label="Last heartbeat" value={line.heartbeat} />
        <Fact label="Current work" value={line.work} />
      </dl>
    </li>
  );
}

function Workers({ data, clients }: { data: OpsHealth; clients: ClientDirectory }) {
  const section = data.sections.workers;
  const unavailable = sectionUnavailable(section);
  if (unavailable) return <Unavailable text={unavailable} />;
  const view = workersView(section.rows ?? [], clients);
  return (
    <>
      <p className="idc-health-summary">
        {view.rows.length === 0
          ? <Badge tone="warn">No workers or lanes were reported</Badge>
          : view.alarms > 0
            ? <Badge tone="bad">{view.alarms} {view.alarms === 1 ? "needs" : "need"} attention</Badge>
            : <Badge tone="ok">Every expected lane has a live worker</Badge>}
      </p>
      {view.rows.length ? <ul className="idc-health-list" aria-label="Workers">{view.rows.map((line) => <WorkerItem key={line.key} line={line} />)}</ul> : null}
      {view.replaced.length ? (
        <details className="idc-health-replaced">
          <summary>{replacedSummary(view.replaced.length)}</summary>
          <ul className="idc-health-list" aria-label="Replaced workers">{view.replaced.map((line) => <WorkerItem key={line.key} line={line} />)}</ul>
        </details>
      ) : null}
    </>
  );
}

function Documents({ data, clients }: { data: OpsHealth; clients: ClientDirectory }) {
  const section = data.sections.documents_24h;
  const unavailable = sectionUnavailable(section, "counts");
  if (unavailable) return <Unavailable text={unavailable} />;
  const counts = section.counts!;
  const rows = section.rows ?? [];
  return (
    <>
      <p className="idc-health-summary">{windowLabel(section.window)}</p>
      <dl className="idc-health-counts" aria-label="Document counts">
        {DOCUMENT_COUNTS.map((count) => <Fact key={count.key} label={count.label} value={String(counts[count.key])} />)}
      </dl>
      {rows.length ? (
        <details className="idc-health-replaced">
          <summary>By client ({rows.length})</summary>
          <ul className="idc-health-list" aria-label="Documents by client">
            {rows.map((row) => (
              <li key={row.client_id} className="idc-health-item">
                <strong>{clientLabel(clients, row.client_id).name}</strong>
                <p className="idc-health-line">{DOCUMENT_COUNTS.map((count) => `${count.label} ${row[count.key]}`).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function Marker({ text, target }: { text: string | null; target: string }) {
  if (!text) return null;
  return <a className="idc-badge neutral idc-health-marker" href={`#${target}`} data-issue-marker={text}>{text}</a>;
}

function Waiting({ data, clients, markers }: { data: OpsHealth; clients: ClientDirectory; markers: Map<string, string> }) {
  const section = data.sections.waiting;
  const unavailable = sectionUnavailable(section);
  if (unavailable) return <Unavailable text={unavailable} />;
  const rows = section.rows ?? [];
  if (!rows.length) return <p className="idc-health-summary">Nothing has waited over one hour.</p>;
  return (
    <ul className="idc-health-list" aria-label="Waiting over one hour">
      {rows.map((row) => {
        const line = waitingLine(row, data.observed_at, clients);
        const key = issueKey(row);
        return (
          <li key={line.key} id={anchor("waiting", key)} className="idc-health-item" data-wait-kind={line.reason.kind}>
            <div className="idc-health-item-top">
              <strong>{line.client} · {line.item}</strong>
              <Badge tone={line.reason.tone}>{line.reason.label}</Badge>
              <Marker text={markers.get(key) ?? null} target={anchor("needs", key)} />
            </div>
            <dl className="idc-health-facts">
              <Fact label="Stage" value={line.stage} />
              <Fact label="Waiting since" value={line.waitedSince} />
              <Fact label="Last recorded progress" value={line.lastProgress} />
              {line.continues ? <Fact label="Next attempt" value={line.continues} /> : null}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function NeedsPerson({ data, clients, markers, onOpenClient, onRetryDelete }: {
  data: OpsHealth; clients: ClientDirectory; markers: Map<string, string>; onOpenClient?: OpenClient;
  onRetryDelete?: RetryDelete;
}) {
  const section = data.sections.needs_person;
  const unavailable = sectionUnavailable(section);
  if (unavailable) return <Unavailable text={unavailable} />;
  const rows = section.rows ?? [];
  if (!rows.length) return <p className="idc-health-summary">Nothing is waiting for a person.</p>;
  const waiting = data.sections.waiting.status === "ok" ? data.sections.waiting.rows ?? [] : [];
  return (
    <ul className="idc-health-list" aria-label="Needs a person">
      {rows.map((row) => {
        const line = needsPersonLine(row, clients);
        const key = issueKey(row);
        const known = clientLabel(clients, row.client_id).known;
        const marker = issueMarker(markers, row, waiting);
        const twin = waiting.find((candidate) => markers.get(issueKey(candidate)) === marker);
        return (
          <li key={line.key} id={anchor("needs", key)} className="idc-health-item" data-function={row.function}>
            <div className="idc-health-item-top">
              <strong>{line.action}</strong>
              <Badge tone="neutral">{line.who}</Badge>
              <Marker text={marker} target={anchor("waiting", twin ? issueKey(twin) : key)} />
            </div>
            <dl className="idc-health-facts">
              <Fact label="Reason" value={line.reason} />
              <Fact label="Age" value={line.age} />
              <Fact label="Client" value={line.client} />
              <Fact label="Item" value={line.item} />
            </dl>
            {onRetryDelete && retriesDelete(row) ? <RetryDeleteButton row={row} onRetryDelete={onRetryDelete} /> : null}
            {known
              ? <ClientLink clientId={row.client_id} section={line.detail.section} label={line.detail.label} onOpenClient={onOpenClient} />
              : <p className="idc-health-line">This client is not in the client list.</p>}
          </li>
        );
      })}
    </ul>
  );
}

function SpendItem({ line }: { line: ReturnType<typeof spendLine> }) {
  return (
    <li className="idc-health-item" data-meter={line.key.split(":").pop()}>
      <div className="idc-health-item-top"><strong>{line.meter}</strong><Badge tone={line.status.tone}>{line.status.label}</Badge></div>
      <dl className="idc-health-facts">
        <Fact label="Known spend" value={line.known} />
        <Fact label="Reserved" value={line.reserved} />
        <Fact label="Limit" value={line.limit} />
        <Fact label="Remaining" value={line.remaining} />
      </dl>
      {line.uncertain ? <p className="idc-health-uncertain">{line.uncertain}</p> : null}
      <p className="idc-health-line">{line.resets}</p>
    </li>
  );
}

function Spend({ data, clients, onOpenClient }: { data: OpsHealth; clients: ClientDirectory; onOpenClient?: OpenClient }) {
  const section = data.sections.spend;
  const unavailable = sectionUnavailable(section);
  if (unavailable) return <Unavailable text={unavailable} />;
  const groups = spendGroups(section.rows ?? [], clients);
  return (
    <>
      <p className="idc-health-summary">{accountingLabel(section)}</p>
      {section.deployment
        ? <ul className="idc-health-list" aria-label="Deployment-wide safeguard"><SpendItem line={spendLine(section.deployment)} /></ul>
        : <Unavailable text={`Deployment-wide safeguard: ${NOT_AVAILABLE}`} />}
      {groups.length === 0 ? <p className="idc-health-summary">No client spend rows were reported.</p> : groups.map((group) => (
        <div key={group.clientId} className="idc-health-group" data-client={group.clientId}>
          <div className="idc-health-group-head">
            <h3>{group.client}</h3>
            {group.known
              ? <ClientLink clientId={group.clientId} section="limits" label="Open Limits" onOpenClient={onOpenClient} />
              : <span className="idc-health-line">Not in the client list</span>}
          </div>
          <ul className="idc-health-list" aria-label={`AI spend for ${group.client}`}>
            {group.lines.map((line) => <SpendItem key={line.key} line={line} />)}
          </ul>
        </div>
      ))}
    </>
  );
}

/** The page for a given state. Pure: the render tests drive it directly. */
export function SystemHealthView({ state, reading = false, clients, onRefresh, onOpenClient, onRetryDelete }: {
  state: HealthState; reading?: boolean; clients: ClientDirectory; onRefresh?: () => void; onOpenClient?: OpenClient;
  onRetryDelete?: RetryDelete;
}) {
  const { data } = state;
  const markers = data && data.sections.waiting.status === "ok" && data.sections.needs_person.status === "ok"
    ? linkedIssues(data.sections.waiting.rows ?? [], data.sections.needs_person.rows ?? [])
    : new Map<string, string>();
  return (
    <div className="idc-health">
      <div className="idc-health-bar">
        <p className="idc-health-observed" aria-live="polite">{data ? observedLabel(data.observed_at) : "Not read yet"}</p>
        <DesignButton variant="outline" size="sm" onClick={onRefresh} disabled={reading}>
          <RefreshCw size={14} /> {reading ? "Refreshing…" : "Refresh"}
        </DesignButton>
      </div>
      {data && state.stale ? <p role="alert" className="idc-note bad idc-health-stale">{staleLabel(data.observed_at)}</p> : null}
      {!data ? (
        state.error
          ? <p role="alert" className="idc-note bad">System health could not be read: {state.error}</p>
          : <LoadingRegion><Skeleton className="h-24 rounded-[12px]" /></LoadingRegion>
      ) : (
        <>
          <Section id="health-workers" title="Workers"><Workers data={data} clients={clients} /></Section>
          <Section id="health-documents" title="Documents added in the last 24 hours"><Documents data={data} clients={clients} /></Section>
          <Section id="health-waiting" title="Waiting over one hour"><Waiting data={data} clients={clients} markers={markers} /></Section>
          <Section id="health-needs-person" title="Needs a person"><NeedsPerson data={data} clients={clients} markers={markers} onOpenClient={onOpenClient} onRetryDelete={onRetryDelete} /></Section>
          <Section id="health-spend" title="Today's AI spend"><Spend data={data} clients={clients} onOpenClient={onOpenClient} /></Section>
        </>
      )}
    </div>
  );
}
