'use client';

import { useState } from 'react';

import type { ScheduleProposal } from '@/lib/product';
import { scheduleCardView } from './schedule-card-view';

/**
 * One schedule card in the agent stream. What it says and offers is decided
 * by `scheduleCardView`; this renders that, and holds the one piece of local
 * state -- whether the client has opened the time editor.
 *
 * No picker by default (the operator's design, 2026-09-24): "Change" opens a
 * small editor INSIDE the card, not the app's regular picker.
 */
export default function ScheduleCard({
  proposal,
  busy,
  error,
  onConfirm,
  onDecline,
}: {
  proposal: ScheduleProposal;
  busy: boolean;
  error?: string;
  onConfirm: (when?: string) => void;
  onDecline: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(proposal.when_local);
  const view = scheduleCardView(proposal);

  return (
    <div className={`rf-schedule-card rf-schedule-card--${view.tone}`} role={view.tone === 'done' ? 'status' : undefined}>
      {view.eyebrow && <p className="rf-schedule-card__eyebrow">{view.eyebrow}</p>}
      <p className="rf-schedule-card__title">{view.title}</p>
      {view.preview && <blockquote className="rf-schedule-card__preview">{view.preview}</blockquote>}
      {view.delivery && <p className="rf-schedule-card__delivery">{view.delivery}</p>}
      {view.note && <p className="rf-schedule-card__note">{view.note}</p>}
      {editing && view.actions.includes('change') && (
        <label className="rf-schedule-card__edit">
          New time
          <input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)} aria-label="New date and time" />
        </label>
      )}
      {error && <p className="rf-schedule-card__error" role="alert">{error}</p>}
      {view.actions.length > 0 && (
        <div className="rf-schedule-card__actions">
          {view.actions.includes('confirm') && (
            <button
              type="button"
              className="rf-schedule-card__confirm"
              disabled={busy}
              onClick={() => onConfirm(editing && when !== proposal.when_local ? when : undefined)}
            >
              {busy ? view.busyLabel : 'Confirm'}
            </button>
          )}
          {view.actions.includes('change') && !editing && (
            <button type="button" disabled={busy} onClick={() => setEditing(true)}>Change</button>
          )}
          {view.actions.includes('dismiss') && (
            <button type="button" disabled={busy} onClick={onDecline}>Dismiss</button>
          )}
        </div>
      )}
    </div>
  );
}
