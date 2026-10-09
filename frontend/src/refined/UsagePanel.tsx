import { useEffect, useState } from 'react';
import { getJson } from '@/lib/api';
import type { KnowledgeEngine } from './state';
import { DELETE_KEEPS_UPLOAD, USAGE_UNAVAILABLE, loadUsage, meterRows, uploadsRow, usageSource, type UsageState } from './usage-display';

/** The row every Usage view before Cycle 5 ended with. Kept for the demo and M1. */
export function WhatCountsRow() {
  return <div className="rf-setting-row"><span><b>What counts as a generation</b><small>Provider usage is recorded server-side when available; this backend exposes no client quota endpoint.</small></span></div>;
}

/** Settings -> Usage for a connected client (Cycle 5 P2.6; spec 10A.4). Pure: the
 *  state comes in, so each state renders in a test without a network. */
export function UsagePanel({ state }: { state: UsageState }) {
  if (state.kind === 'm1') {
    // A47: under M1 nothing new appears; this is the copy as it was before P2.6.
    return <><div className="rf-usage"><b>—</b><span>Usage balance is not reported by the previous backend</span><small>No plan or quota has been invented.</small></div><WhatCountsRow /></>;
  }
  if (state.kind === 'loading') return <div className="rf-usage rf-usage-ke"><p role="status" className="rf-usage-message">Loading usage…</p></div>;
  if (state.kind === 'error') return <div className="rf-usage rf-usage-ke"><p role="alert" className="rf-usage-message">{USAGE_UNAVAILABLE}</p></div>;
  const uploads = uploadsRow(state.usage.uploads);
  return <div className="rf-usage rf-usage-ke">
    <section className="rf-usage-group" aria-label="Uploads">
      <h4>Uploads</h4>
      <span className="rf-usage-summary">{uploads.summary}</span>
      {uploads.note && <small data-reached={uploads.reached || undefined}>{uploads.note}</small>}
      <small className="rf-usage-delete-note">{DELETE_KEEPS_UPLOAD}</small>
    </section>
    <section className="rf-usage-group" aria-label="Budgets">
      {meterRows(state.usage).map(row => <div key={row.label} className="rf-usage-meter" data-state={row.state}>
        <div className="rf-usage-meter-head"><b>{row.label}</b><span>{row.usage}</span></div>
        {row.fraction !== null && <progress value={Math.round(row.fraction * 100)} max={100} aria-label={`${row.label}: ${row.usage}`} />}
        {row.note && <small>{row.note}</small>}
      </div>)}
    </section>
  </div>;
}

/** Settings -> Usage for a connected client. The engine the app already knows
 *  decides first (A47): under the rehaul engine the figures are read each time the
 *  section opens; otherwise (M1, or the engine not known) the old copy shows at
 *  once and `/v1/usage` is never read (P2 milestone review M5: never blank). */
export default function UsageSection({ engine }: { engine: KnowledgeEngine | null }) {
  if (usageSource(engine) === 'm1') return <UsagePanel state={{ kind: 'm1' }} />;
  return <LiveUsage />;
}

function LiveUsage() {
  const [state, setState] = useState<UsageState>({ kind: 'loading' });
  useEffect(() => {
    let active = true;
    void loadUsage(getJson).then(next => { if (active) setState(next); });
    return () => { active = false; };
  }, []);
  return <UsagePanel state={state} />;
}
