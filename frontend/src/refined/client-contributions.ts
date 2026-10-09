// "What would you like us to know?" on the new engine (Cycle 5 P6.8; spec 5.1; A09; review I-4).
//
// Browser-safe and free of React, so the rules can be tested directly:
// - a note is ONE item, and the client says what it is (`CONTRIBUTION_KINDS`):
//   "Something about me or my business" (the default) or "How I want my posts
//   written". No model sorts it (the splitter was removed, 2026-10-08);
// - a note carries an intent key minted HERE, in the browser, and sending the
//   same note again reuses it (`contributionIntent`), so a lost reply never
//   records it twice (A08);
// - the reply says what changed: the fact added, or the proposed guidance line
//   (`summarizeContribution`);
// - a proposed line is never saved automatically. "Add to my guidance" opens the
//   guidance editor with the line appended (`appendLine`); the client saves.

import type { ContributionKind, ContributionOut, ContributionSection, GuidanceProposalOut } from '@/lib/product';
import { checkGuidance } from './guidance';

/** The backend's own limit: one note is one item. */
export const CONTRIBUTION_TEXT_MAX = 500;
export const CONTRIBUTE_TITLE = 'What would you like us to know?';

/** The two kinds, in the form's order; the first is the default. */
export const CONTRIBUTION_KINDS: ReadonlyArray<{ kind: ContributionKind; label: string }> = [
  { kind: 'fact', label: 'Something about me or my business' },
  { kind: 'writing', label: 'How I want my posts written' },
];

/** `section`: the Business DNA section the note is sent from (P9 fix round 1), so its fact lands there. */
export type ContributionIntent = { text: string; kind: ContributionKind; key: string; section?: ContributionSection };

/** The previous intent when it is the same note (a retry), else a new key. */
export function contributionIntent(previous: ContributionIntent | null, text: string, kind: ContributionKind = 'fact',
  mint: () => string = () => crypto.randomUUID(), section?: ContributionSection): ContributionIntent {
  if (previous && previous.text === text && previous.kind === kind && previous.section === section) return previous;
  return section ? { text, kind, key: mint(), section } : { text, kind, key: mint() };
}

export type ContributionSummary = {
  /** What was added to the client's knowledge, one sentence each. */
  facts: string[];
  /** Proposed guidance lines, for "Add to my guidance". */
  proposals: string[];
  /** Why nothing has been applied yet, when it has not. */
  pending: string | null;
  /** Anything else the reply says (why it was not applied). */
  notes: string[];
};

export function summarizeContribution(reply: ContributionOut): ContributionSummary {
  const facts: string[] = [];
  const proposals: string[] = [];
  for (const effect of reply.effects ?? []) {
    if (effect.kind === 'fact' && typeof effect.summary === 'string') facts.push(effect.summary);
    if (effect.kind === 'guidance' && effect.change === 'proposed' && typeof effect.instruction === 'string') {
      proposals.push(effect.instruction);
    }
  }
  const notes = reply.application_state === 'failed' && reply.application_note ? [reply.application_note] : [];
  const pending = reply.application_state === 'pending'
    ? 'Saved. We couldn’t apply it yet — send it again in a moment.'
    : null;
  return { facts, proposals, pending, notes };
}

/** The guidance with one line appended, as the editor opens it. Nothing is saved here. */
export function appendLine(current: string | null | undefined, line: string): string {
  const base = (current ?? '').replace(/\s+$/, '');
  const addition = line.trim();
  if (!base) return addition;
  if (base.split('\n').some(existing => existing.trim() === addition)) return base;
  return `${base}\n${addition}`;
}

/** Whether the editor's text can be saved (the guidance rules: not empty, within 2,000). */
export function canSave(draft: string): boolean {
  return checkGuidance(draft).ok;
}

export class ContributionRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ContributionRequestError';
  }
}

async function request<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init.headers ?? {}) } });
  } catch {
    throw new ContributionRequestError(fallback, 0);
  }
  const body = await response.json().catch(() => ({})) as T & { error?: unknown };
  if (!response.ok) {
    throw new ContributionRequestError(typeof body.error === 'string' && body.error ? body.error : fallback, response.status);
  }
  return body;
}

export function postContribution(intent: ContributionIntent): Promise<ContributionOut> {
  return request<ContributionOut>('/api/client/contributions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent_key: intent.key, text: intent.text, kind: intent.kind,
      ...(intent.section ? { section: intent.section } : {}) }),
  }, 'Your message was not sent. Try again.');
}

export async function loadProposals(): Promise<GuidanceProposalOut[]> {
  const body = await request<{ proposals?: GuidanceProposalOut[] }>(
    '/api/client/contributions/proposals', {}, 'Could not load suggested guidance.');
  return Array.isArray(body.proposals) ? body.proposals : [];
}
