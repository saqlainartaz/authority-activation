import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EMPTY_DRAFT } from '@/components/questions/QuestionCard';
import { knowledgeStatus, SWITCHED_OFF_DETAIL, type SourceUse } from '@/lib/knowledge-status';
import { applySourceOverview } from '@/lib/source-overview';
import type { ClientQuestion } from '@/refined/client-questions';
import { ServerSourceRow, SourceListEmpty } from '@/refined/KnowledgeSource';
import type { Engine, ServerDocument } from '@/refined/knowledge-view';
import { QuestionsPanelView, SOURCE_QUESTIONS_UNAVAILABLE } from '@/refined/QuestionsPanel';
import { CLOSED_USE_COPY, REPLACED_USE_COPY, SourceDetails, SourcePopupView, USE_OFF_NOTE } from '@/refined/SourcePopup';

/**
 * Cycle 5 P7.2 (spec §7.1-7.3; A17, A20, A21, A35): a knowledge source's row and
 * popup on the rehaul engine, rendered. Under M1 (and before the engine is
 * known) none of it renders: the Knowledge screen there is what it always was.
 */

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const noop = () => undefined;

const available = knowledgeStatus({ state: 'ready' }, { state: 'active', yield: 'evidence' }, []);
const MIXED: ServerDocument = {
  id: '22222222-2222-4222-8222-222222222222', source_type: 'Acme_and_Beta brief.pdf', source_authority: 'CLIENT',
  status: 'atomised', created_at: '2026-10-06T09:00:00Z', filename: 'Acme_and_Beta brief.pdf', closed: false,
  knowledge: available, labels: [{ label: 'Acme Physio', kind: 'organization' }, { label: 'Beta Fitness', kind: 'brand' }],
  use: { state: 'on', requested: null, revision: 2 },
};
const TOO_LONG: ServerDocument = {
  ...MIXED, id: '33333333-3333-4333-8333-333333333333', filename: 'board pack.docx', labels: [],
  knowledge: knowledgeStatus({ state: 'parsed', lane: 'document' }, null, [{ kind: 'source_size_rejected' }]),
};
const [SWITCHED_OFF] = applySourceOverview([{ ...MIXED, id: '44444444-4444-4444-8444-444444444444' }],
  [{ document_id: '44444444-4444-4444-8444-444444444444', labels: [], use: { state: 'off', requested: null, revision: 3 } }]);
const WITHDRAWN: ServerDocument = {
  ...MIXED, id: '55555555-5555-4555-8555-555555555555', closed: true, use: null, labels: [],
  knowledge: knowledgeStatus({ state: 'withdrawn' }, null, []),
};

const row = (document: ServerDocument, engine: Engine = 'ke') =>
  text(renderToStaticMarkup(createElement(ServerSourceRow, { document, engine, onOpen: noop })));
const details = (document: ServerDocument, use: SourceUse | null, engine: Engine = 'ke', extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(SourceDetails, { document, engine, use, busy: false, note: null, onToggle: noop, ...extra }));

describe('a source row on the rehaul engine (A17)', () => {
  it('shows the file name, type and date, status, and every business label', () => {
    expect(row(MIXED)).toBe('Acme_and_Beta brief.pdf PDF · 6 Oct 2026 Acme Physio Beta Fitness Available');
  });

  it('says "Too long — split it into smaller files" for a file over the page limit', () => {
    expect(row(TOO_LONG)).toBe('board pack.docx DOCX · 6 Oct 2026 · Too long — split it into smaller files Needs your help');
  });

  it('shows a switched-off source as Not in use, still listed', () => {
    expect(row(SWITCHED_OFF)).toContain(`${SWITCHED_OFF_DETAIL} Not in use`);
  });
});

describe('the source popup (A20, A21)', () => {
  it('shows identity, status and the switch, on', () => {
    const html = details(MIXED, MIXED.use!);
    const words = text(html);
    expect(words).toContain('Status Available');
    expect(words).toContain('Type PDF');
    expect(words).toContain('Added 6 October 2026');
    expect(words).toContain('About Acme Physio Beta Fitness');
    expect(words).toContain('Use this source On');
    expect(words).toContain(USE_OFF_NOTE);
    expect(html).toMatch(/role="switch"[^>]*aria-label="Use this source"|aria-label="Use this source"[^>]*role="switch"/);
    expect(html).toMatch(/aria-checked="true"/);
    // No download in this release (D07), and nothing else offered.
    expect(words).not.toMatch(/Download|Remove|Reprocess|Delete/);
  });

  it('shows the reason a file is too long, and how to fix it', () => {
    const words = text(details(TOO_LONG, { state: 'on', requested: null, revision: 0 }));
    expect(words).toContain('Needs your help Too long — split it into smaller files This file is longer than the 13-page limit.');
  });

  it('shows Pending until the change is enforced, with the switch held', () => {
    const html = details(MIXED, { state: 'pending', requested: 'off', revision: 3 });
    expect(text(html)).toContain('Use this source Pending · turning off');
    expect(html).toMatch(/aria-checked="false"/);
    expect(html).toMatch(/ data-disabled=""/);
  });

  it('shows Off for a switched-off source, which can be switched back on', () => {
    const html = details(SWITCHED_OFF, SWITCHED_OFF.use!);
    expect(text(html)).toContain(`Status Not in use ${SWITCHED_OFF_DETAIL}`);
    expect(text(html)).toContain('Use this source Off');
    expect(html).not.toMatch(/ data-disabled=""/);
  });

  it("never offers the switch on a source the operator stopped, nor calls it Off", () => {
    const html = details(WITHDRAWN, null);
    const words = text(html);
    expect(words).toContain('Status Not in use The file is kept but no longer used.');
    expect(words).toContain(`Use this source ${CLOSED_USE_COPY}`);
    expect(CLOSED_USE_COPY).toMatch(/^Our team stopped using this file/);
    expect(html).not.toContain('role="switch"');
    expect(words).not.toMatch(/\bOff\b|Pending/);
  });

  it('says in plain words why a replaced source has no switch', () => {
    const replaced = { ...WITHDRAWN, knowledge: knowledgeStatus({ state: 'superseded' }, null, []) };
    const words = text(details(replaced, null));
    expect(words).toContain(`Use this source ${REPLACED_USE_COPY}`);
    expect(words).not.toContain(CLOSED_USE_COPY);
  });

  it('shows a refusal or a failed change beside the switch', () => {
    expect(text(details(MIXED, MIXED.use!, 'ke', { note: 'This source changed since you opened it. Its current setting is shown.' })))
      .toContain('This source changed since you opened it.');
  });

  it('renders nothing under M1, or before the engine is known', () => {
    for (const engine of ['m1', null] as const) {
      expect(details(MIXED, MIXED.use!, engine)).toBe('');
      expect(renderToStaticMarkup(createElement(SourcePopupView, {
        document: MIXED, engine, use: MIXED.use!, busy: false, note: null, onToggle: noop, onClose: noop,
      }))).toBe('');
    }
  });
});

describe("the popup's inline question (A20)", () => {
  const QUESTION: ClientQuestion = {
    id: 'q-1', packet_id: null, origin: 'event', status: 'open', created_at: '2026-10-08T12:00:00Z',
    control: 'single', prompt: 'Which price is current for membership?', why: 'The two files disagree.',
    options: [{ id: 'k0', label: 'USD 49' }, { id: 'k1', label: 'USD 59' }], allow_alternative: false, allow_uncertain: true,
    evidence_refs: [{ document_id: MIXED.id }], pending_answer: null,
  };
  const panel = (props: Partial<Parameters<typeof QuestionsPanelView>[0]>) => text(renderToStaticMarkup(createElement(QuestionsPanelView, {
    phase: 'ready', questions: [], draft: EMPTY_DRAFT, busy: false, error: null, changed: null,
    onRetry: noop, onDraft: noop, onSubmit: noop, quiet: true, title: 'A question about this file', ...props,
  })));

  it('asks only when there is a question about this source', () => {
    expect(panel({})).toBe('');
    expect(panel({ phase: 'loading' })).toBe('');
    const words = panel({ questions: [QUESTION] });
    expect(words).toContain('A question about this file 1 of 1 Which price is current for membership?');
    expect(words).toContain('Save answer');
  });

  it('says what changed once answered, and a failed read is one line with Retry', () => {
    expect(panel({ changed: { prompt: QUESTION.prompt, text: 'Membership is USD 59.' } })).toContain('What changed Membership is USD 59.');
    expect(panel({ phase: 'error' })).toBe(`${SOURCE_QUESTIONS_UNAVAILABLE} Retry`);
  });
});

describe('the empty states (A35)', () => {
  const empty = (total: number, shown: number, query = '') =>
    text(renderToStaticMarkup(createElement(SourceListEmpty, { total, shown, query, onAddFiles: noop, onClearSearch: noop })));

  it('offers Add files with no sources, Clear search with no matches, and nothing otherwise', () => {
    expect(empty(0, 0)).toBe('No files yet Add documents, transcripts or notes, and each one shows its status here. Add files');
    expect(empty(3, 0, ' invoice ')).toBe('No sources match “invoice” Search looks at file names. Clear search');
    expect(empty(3, 1, 'acme')).toBe('');
  });
});
