"use client";

// The operator Limits card (Cycle 5 P2.5; spec §10.2): a client's monthly upload
// allowance, its three AI budgets, a plain edit form and the change history.
// Rehaul engine only: the console shows this section only when the deployment
// runs it.
//
// Extra uploads carry one intent key per operator action (`useIntentKey`),
// reused until a definitive answer. The edit form is a plain PUT against the
// revision it was built from. After an attempt with no answer the values and
// history are read again, so the operator sees whether it was saved. (Temporary
// increases and the frozen "Send again" form were removed as over-engineered,
// 2026-10-08.)

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { Button, Card } from "@/components/ui/primitives";
import { LoadingRegion, Skeleton } from "@/components/ui/admin-skeleton";
import {
  CLIENT_BUDGETS,
  EARLIER_ATTEMPT_SAVED_MESSAGE,
  RELOAD_FAILED_MESSAGE,
  STALE_LIMITS_MESSAGE,
  formFromLimits,
  formatUsd,
  formatUtc,
  historyValue,
  limitsEditBody,
  limitsRefusalMessage,
  mergeForm,
  meterView,
  principalLabel,
  settingLabel,
  uploadsView,
  type ClientLimits,
  type LimitChange,
  type LimitChangesPage,
  type LimitsForm,
} from "@/lib/limits";
import { useIntentKey } from "@/lib/use-intent-key";
import { failureCode, type InternalApi } from "./internal-api";
import { sendLimitsAction, type LimitsOutcome } from "./limits-actions";

type Notice = { tone: "ok" | "warn" | "bad"; text: string } | null;
/** Reads the limits and the history again; null when the limits could not be read. */
type Refresh = () => Promise<ClientLimits | null>;

const HISTORY_PAGE_SIZE = 20;

function PanelLoading() {
  return <LoadingRegion><Skeleton className="h-24 rounded-[12px]" /></LoadingRegion>;
}

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  if (notice.tone === "ok") return <p role="status" className="idc-limits-notice ok">{notice.text}</p>;
  return <p role="alert" className={`idc-limits-notice ${notice.tone}`}>{notice.text}</p>;
}

function loadMessage(error: unknown, fallback: string): string {
  const code = failureCode(error);
  return limitsRefusalMessage(code, error instanceof Error ? error.message : fallback);
}

/** One mutation: busy state and notice. Each card's action gets its own. `keyed`
 *  actions (extra uploads) carry an intent key; the edit form does not. `onCheck`
 *  reads the limits and history again. */
function useLimitsAction(api: InternalApi, path: string, method: "PUT" | "POST", onCheck: Refresh, keyed: boolean) {
  const holder = useIntentKey();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const run = useCallback(async (body: Record<string, unknown>): Promise<LimitsOutcome> => {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendLimitsAction(api, keyed ? holder : null, path, method, body);
      if (outcome.kind === "retry") {
        // No answer: read back what is saved now, so the operator can see it.
        const fresh = await onCheck();
        setNotice(fresh ? { tone: "warn", text: outcome.message } : { tone: "bad", text: RELOAD_FAILED_MESSAGE });
      } else if (outcome.kind === "refused" && outcome.code === "intent_key_reused") {
        // An earlier attempt of this action landed: show what is saved now. The
        // key is already settled (a 4xx), so the next action gets a new one.
        const fresh = await onCheck();
        setNotice(fresh ? { tone: "warn", text: EARLIER_ATTEMPT_SAVED_MESSAGE } : { tone: "bad", text: RELOAD_FAILED_MESSAGE });
      } else if (outcome.kind === "refused") setNotice({ tone: "bad", text: outcome.message });
      return outcome;
    } finally {
      setBusy(false);
    }
  }, [api, holder, keyed, method, onCheck, path]);

  return { run, busy, notice, setNotice };
}

function SubmitButton({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }) {
  return <div className="idc-form-actions"><Button type="submit" size="sm" disabled={busy}>{busy ? busyLabel : label}</Button></div>;
}

export function LimitsPanel({ clientId, api }: { clientId: string; api: InternalApi }) {
  const [limits, setLimits] = useState<ClientLimits | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void api<ClientLimits>(`/api/internal/clients/${clientId}/limits`)
      .then((next) => { if (active) setLimits(next); })
      .catch((caught) => { if (active) setLoadError(loadMessage(caught, "Unable to load this client's limits.")); });
    return () => { active = false; };
  }, [api, clientId]);

  const refresh = useCallback<Refresh>(async () => {
    setHistoryVersion((version) => version + 1);
    try {
      const next = await api<ClientLimits>(`/api/internal/clients/${clientId}/limits`);
      setLimits(next);
      return next;
    } catch {
      return null;
    }
  }, [api, clientId]);

  const saved = useCallback((next: ClientLimits) => {
    setLimits(next);
    setHistoryVersion((version) => version + 1);
  }, []);

  if (loadError) return <Card className="idc-card p-6"><p role="alert" className="text-sm text-danger">{loadError}</p></Card>;
  if (!limits) return <PanelLoading />;

  return (
    <div className="idc-limits">
      <UploadsCard clientId={clientId} api={api} limits={limits} onSaved={saved} onRefresh={refresh} />
      <BudgetsCard limits={limits} />
      <EditLimitsCard clientId={clientId} api={api} initial={limits} onSaved={saved} onRefresh={refresh} />
      <HistoryCard clientId={clientId} api={api} version={historyVersion} />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="idc-limits-fact"><dt>{label}</dt><dd>{value}</dd></div>;
}

function monthLabel(month: string): string {
  const at = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return month;
  return at.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function UploadsCard({ clientId, api, limits, onSaved, onRefresh }: {
  clientId: string; api: InternalApi; limits: ClientLimits; onSaved: (limits: ClientLimits) => void; onRefresh: Refresh;
}) {
  const action = useLimitsAction(api, `/api/internal/clients/${clientId}/limits/extra-uploads`, "POST", onRefresh, true);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const uploads = uploadsView(limits);

  function done(outcome: LimitsOutcome) {
    if (outcome.kind !== "saved") return;
    const extra = Number(amount.trim());
    onSaved(outcome.limits);
    setAmount("");
    setReason("");
    action.setNotice({ tone: "ok", text: `${extra} extra ${extra === 1 ? "upload" : "uploads"} added for this month.` });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const extra = Number(amount.trim());
    if (!Number.isInteger(extra) || extra <= 0 || extra > 10_000) {
      action.setNotice({ tone: "bad", text: "Enter a whole number of extra uploads, from 1 to 10,000." });
      return;
    }
    if (!reason.trim()) {
      action.setNotice({ tone: "bad", text: "Give a reason for the extra uploads." });
      return;
    }
    done(await action.run({ extra_uploads: extra, reason: reason.trim() }));
  }

  return (
    <Card className="idc-card idc-limits-card">
      <div className="idc-limits-head">
        <h2>Monthly upload allowance</h2>
        <p>{monthLabel(limits.month)} (UTC). Resets {formatUtc(limits.resets.monthly)}.</p>
      </div>
      <dl className="idc-limits-facts" aria-label="Uploads this month">
        <Fact label="Base allowance" value={uploads.base} />
        <Fact label="Extra this month" value={uploads.extra} />
        <Fact label="Used" value={uploads.used} />
        <Fact label="Remaining" value={uploads.remaining} />
      </dl>
      <form className="idc-limits-form" onSubmit={submit} aria-label="Give extra uploads">
        <h3>Give extra uploads</h3>
        <p className="idc-limits-hint">For this month only. The base allowance is unchanged.</p>
        <div className="idc-form-grid">
          <label className="idc-field">Extra uploads<input className="idc-input" type="number" min={1} step={1} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="idc-field">Reason<input className="idc-input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
        </div>
        <SubmitButton busy={action.busy} label="Add extra uploads" busyLabel="Adding…" />
        <NoticeLine notice={action.notice} />
      </form>
    </Card>
  );
}

function BudgetsCard({ limits }: { limits: ClientLimits }) {
  return (
    <Card className="idc-card idc-limits-card">
      <div className="idc-limits-head">
        <h2>AI budgets</h2>
        <p>What this client&apos;s AI work may spend. Documents covers document processing; Writing covers the writing agent. Used includes amounts reserved for work in progress.</p>
      </div>
      <ul className="idc-limits-meters" aria-label="Budgets">
        {CLIENT_BUDGETS.map((budget) => {
          const meter = limits.meters[budget.meter];
          const view = meterView(meter);
          const resets = budget.period === "month" ? limits.resets.monthly : limits.resets.daily;
          return (
            <li key={budget.meter} className="idc-limits-meter" data-meter={budget.meter}>
              <div className="idc-limits-meter-top">
                <strong>{budget.label}</strong>
                {view.status ? <span className={`idc-badge ${view.status === "Limit reached" ? "bad" : "warn"}`}>{view.status}</span> : null}
              </div>
              <p className="idc-limits-money">
                Limit {formatUsd(meter?.limit_usd ?? null)} · Used {formatUsd(meter?.spent_usd ?? null)} (including reserved)
              </p>
              {view.fraction === null
                ? <p className="idc-limits-bar-missing">{view.usage}</p>
                : <div className="idc-limits-bar" role="progressbar" aria-label={`${budget.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.fraction * 100)}>
                    <span style={{ width: `${view.fraction * 100}%` }} data-reached={view.status === "Limit reached" ? "true" : undefined} />
                  </div>}
              <p className="idc-limits-hint">{view.fraction === null ? "" : `${view.usage} · `}Resets {formatUtc(resets)}</p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The edit form keeps its own BASELINE: the limits it was built from. It diffs
 *  against them and sends their revision, so a save made after someone else's
 *  change is refused as `stale_limits` rather than reverting it (spec §10.2;
 *  review I1). Newer limits brought back by the extra-uploads card do not rebase
 *  it; only its own save, a stale refusal or an attempt with no answer does. */
function EditLimitsCard({ clientId, api, initial, onSaved, onRefresh }: {
  clientId: string; api: InternalApi; initial: ClientLimits;
  onSaved: (limits: ClientLimits) => void; onRefresh: Refresh;
}) {
  const [baseline, setBaseline] = useState<ClientLimits>(initial);
  const [form, setForm] = useState<LimitsForm>(() => formFromLimits(initial));
  const [touched, setTouched] = useState<ReadonlySet<keyof LimitsForm>>(() => new Set());
  const [reason, setReason] = useState("");

  // Rebase on limits read back deliberately: keep what was typed, take the
  // current value for everything else.
  const rebase = useCallback((current: ClientLimits) => {
    setBaseline(current);
    setForm((typed) => mergeForm(formFromLimits(current), typed, touched));
  }, [touched]);

  const checkAndRebase = useCallback<Refresh>(async () => {
    const current = await onRefresh();
    if (current) rebase(current);
    return current;
  }, [onRefresh, rebase]);

  const action = useLimitsAction(api, `/api/internal/clients/${clientId}/limits`, "PUT", checkAndRebase, false);

  function edit<K extends keyof LimitsForm>(field: K, value: LimitsForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set([...current, field]));
  }

  async function done(outcome: LimitsOutcome) {
    if (outcome.kind === "saved") {
      onSaved(outcome.limits);
      setBaseline(outcome.limits);
      setForm(formFromLimits(outcome.limits));
      setTouched(new Set());
      setReason("");
      action.setNotice({ tone: "ok", text: "Limits saved." });
    } else if (outcome.kind === "refused" && outcome.code === "stale_limits") {
      // Someone else saved first: read the current values, keep what this
      // operator typed, and ask them to look again before saving.
      const current = await checkAndRebase();
      action.setNotice({ tone: "bad", text: current ? STALE_LIMITS_MESSAGE : RELOAD_FAILED_MESSAGE });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action.busy) return;
    const { body, error } = limitsEditBody(baseline, form, reason);
    if (!body) { action.setNotice({ tone: "bad", text: error ?? "Nothing has changed." }); return; }
    await done(await action.run(body));
  }

  return (
    <Card className="idc-card idc-limits-card">
      <form className="idc-limits-form" onSubmit={submit} aria-label="Change limits">
        <div className="idc-limits-head">
          <h2>Change limits</h2>
          <p>Only the values you change are saved. Lowering a limit below what is used stops new work; nothing is deleted.</p>
        </div>
        <div className="idc-form-grid">
            <label className="idc-field">Monthly upload allowance
              <input className="idc-input" type="number" min={0} step={1} inputMode="numeric" disabled={form.unlimitedUploads} value={form.unlimitedUploads ? "" : form.monthlyUploads} onChange={(event) => edit("monthlyUploads", event.target.value)} />
            </label>
            <label className="idc-field idc-limits-check">
              <input type="checkbox" checked={form.unlimitedUploads} onChange={(event) => edit("unlimitedUploads", event.target.checked)} />
              Unlimited uploads (the AI budgets still apply)
            </label>
            <label className="idc-field">Documents daily budget (US$)
              <input className="idc-input" type="number" min={0} step="0.01" inputMode="decimal" value={form.documentsDaily} onChange={(event) => edit("documentsDaily", event.target.value)} />
            </label>
            <label className="idc-field">Writing daily budget (US$)
              <input className="idc-input" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Not set" value={form.writingDaily} onChange={(event) => edit("writingDaily", event.target.value)} />
            </label>
            <label className="idc-field">Writing monthly budget (US$)
              <input className="idc-input" type="number" min={0} step="0.01" inputMode="decimal" placeholder="Not set" value={form.writingMonthly} onChange={(event) => edit("writingMonthly", event.target.value)} />
            </label>
            <label className="idc-field">Reason
              <input className="idc-input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
        </div>
        <SubmitButton busy={action.busy} label="Save changes" busyLabel="Saving…" />
        <NoticeLine notice={action.notice} />
      </form>
    </Card>
  );
}

function HistoryCard({ clientId, api, version }: { clientId: string; api: InternalApi; version: number }) {
  const [items, setItems] = useState<LimitChange[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // The first page a "Load more" belongs to. A refresh while it is in flight
  // starts a new chain; the older page must not be appended to it (review M3).
  const chain = useRef(version);

  useEffect(() => {
    chain.current = version;
    let active = true;
    void api<LimitChangesPage>(`/api/internal/clients/${clientId}/limits/changes?limit=${HISTORY_PAGE_SIZE}`)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNext(page.next);
        setError(null);
      })
      .catch((caught) => { if (active) setError(loadMessage(caught, "Unable to load the change history.")); });
    return () => { active = false; };
  }, [api, clientId, version]);

  async function loadMore() {
    if (!next || loadingMore) return;
    const started = chain.current;
    setLoadingMore(true);
    try {
      const page = await api<LimitChangesPage>(
        `/api/internal/clients/${clientId}/limits/changes?limit=${HISTORY_PAGE_SIZE}&before=${encodeURIComponent(next)}`,
      );
      if (chain.current !== started) return;
      setItems((current) => [...(current ?? []), ...page.items]);
      setNext(page.next);
      setError(null);
    } catch (caught) {
      if (chain.current === started) setError(loadMessage(caught, "Unable to load older changes."));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Card className="idc-card idc-limits-card">
      <div className="idc-limits-head">
        <h2>Change history</h2>
        <p>Every change, newest first, with who made it and why. Times are UTC.</p>
      </div>
      {error ? <p role="alert" className="idc-limits-notice bad">{error}</p> : null}
      {items === null && !error ? <PanelLoading /> : null}
      {items && items.length === 0 ? <p className="idc-limits-hint">No changes recorded yet.</p> : null}
      {items && items.length > 0
        ? <ul className="idc-rows idc-limits-history" aria-label="Change history">
            {items.map((item, index) => (
              <li key={`${item.created_at}-${item.setting}-${index}`} className="idc-row">
                <div className="idc-row-main">
                  <strong>{settingLabel(item.setting)}</strong>
                  <small>{historyValue(item.setting, item.old_value)} → {historyValue(item.setting, item.new_value)}</small>
                  <small>{item.reason}</small>
                  <small>{principalLabel(item.changed_by)} · {formatUtc(item.created_at)}</small>
                </div>
              </li>
            ))}
          </ul>
        : null}
      {next ? <div className="idc-form-actions"><Button type="button" size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</Button></div> : null}
    </Card>
  );
}
