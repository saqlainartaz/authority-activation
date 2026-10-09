'use client';

import { useCallback, useEffect, useState } from 'react';

import { getJson, HttpError, postJson } from '@/lib/api';
import type { ScheduleProposal } from '@/lib/product';

/**
 * The schedule cards for one conversation, read from the server's record.
 *
 * Not from the stream: the stream only says a card exists (`schedule.proposed`,
 * an id), and this reads what the card says. So a reload shows the same cards,
 * a stale one says it is stale, and nothing the model wrote reaches the card.
 * Refetched whenever `refreshKey` moves -- a new proposal this turn, or a new
 * message in the conversation.
 */
export function useScheduleProposals(sessionId: string | null, refreshKey: string) {
  const [proposals, setProposals] = useState<ScheduleProposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!sessionId) { setProposals([]); return; }
    try {
      setProposals(await getJson<ScheduleProposal[]>(`/api/client/chat/sessions/${encodeURIComponent(sessionId)}/schedule-proposals`));
    } catch {
      // A card list that fails to load shows nothing rather than a guess; the
      // agent's own reply still says a card was proposed.
    }
  }, [sessionId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const act = useCallback(async (proposalId: string, action: 'confirm' | 'decline', when?: string) => {
    if (!sessionId) return;
    setBusy(proposalId);
    setErrors(current => { const next = { ...current }; delete next[proposalId]; return next; });
    try {
      const path = `/api/client/chat/sessions/${encodeURIComponent(sessionId)}/schedule-proposals/${encodeURIComponent(proposalId)}/${action}`;
      // Safe to retry: the server keys the schedule by the proposal, so a
      // repeated confirm returns the first result.
      const updated = await postJson<ScheduleProposal>(path, action === 'confirm' && when ? { when } : {});
      setProposals(current => current.map(p => (p.id === updated.id ? updated : p)));
    } catch (error) {
      const message = error instanceof HttpError ? error.message : 'That did not go through. Try again.';
      setErrors(current => ({ ...current, [proposalId]: message }));
      await load();
    } finally {
      setBusy(null);
    }
  }, [sessionId, load]);

  return {
    proposals,
    busy,
    errors,
    confirm: (proposalId: string, when?: string) => act(proposalId, 'confirm', when),
    decline: (proposalId: string) => act(proposalId, 'decline'),
  };
}

export type ScheduleProposals = ReturnType<typeof useScheduleProposals>;
