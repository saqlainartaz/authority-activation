import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FileText } from 'lucide-react';

import { RemoveSourceButton, RemoveSourceConfirm, SourceDetailActions } from '@/app/internal/documents-panel';
import { Button } from '@/components/ui/button';
import { ServerSourceFooter, ServerSourceRow } from '@/refined/KnowledgeSource';
import type { Engine, ServerDocument } from '@/refined/knowledge-view';

/**
 * Cycle 5 P2.7 (spec §7.2-7.3, A47): a Knowledge source as the client sees it,
 * and the operator's source removal, rendered under each engine.
 */

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
const noop = () => undefined;

const M1_DOC: ServerDocument = {
  id: '0123456789ab', source_type: 'brand_doc', source_authority: 'CONVERSATIONAL', status: 'atomised',
  created_at: '2026-10-01T10:00:00Z',
};
const PAUSED: ServerDocument = {
  id: 'abcdef012345', source_type: 'board_pack.pdf', source_authority: 'CLIENT', status: 'uploaded',
  created_at: '2026-10-06T09:00:00Z',
  knowledge: { label: 'Paused · daily spending limit', tone: 'waiting', detail: 'Continues after 00:01 UTC on 7 October',
    resumes_at: '2026-10-07T00:01:00.000Z' },
};
const WITHDRAWN: ServerDocument = {
  ...PAUSED, id: 'withdrawn0001', status: 'failed',
  knowledge: { label: 'Not in use', tone: 'off', detail: 'The file is kept but no longer used.' },
};

const row = (document: ServerDocument, engine: Engine) =>
  renderToStaticMarkup(createElement(ServerSourceRow, { document, engine, onOpen: noop }));
// The row exactly as `Knowledge.tsx` wrote it before P2.7, built here without JSX.
const originalRow = (document: ServerDocument) => renderToStaticMarkup(createElement('li', { className: 'rf-uploaded-source' },
  createElement(Button, { variant: 'ghost', className: 'rf-source-open', onClick: noop },
    createElement(FileText),
    createElement('b', null, document.source_type.replaceAll('_', ' '), createElement('small', null, document.id.slice(0, 8), ' · ', document.status)),
    createElement('span', { className: 'rf-source-meta' }, document.status === 'atomised' ? 'Learned' : document.status === 'failed' ? 'Failed' : 'Processing'))));
const footer = (document: ServerDocument, engine: Engine) =>
  renderToStaticMarkup(createElement(ServerSourceFooter, { document, engine, busy: false, onRemove: noop, onReprocess: noop }));

describe('the client Knowledge screen', () => {
  it('shows the §7.2 label and when a paused source continues under ke', () => {
    const words = text(row(PAUSED, 'ke'));
    expect(words).toContain('board pack.pdf');
    expect(words).toContain('Continues after 00:01 UTC on 7 October');
    expect(words).toMatch(/Paused · daily spending limit$/);
    expect(words).not.toMatch(/Learned|Failed|uploaded/);
  });

  it('shows a withdrawn source as not in use, never deleted', () => {
    const words = text(row(WITHDRAWN, 'ke'));
    expect(words).toContain('Not in use');
    expect(words).not.toMatch(/delet|fail/i);
  });

  it('shows the old row, exactly, under M1', () => {
    for (const status of ['atomised', 'failed', 'uploaded'] as const) {
      const document = { ...M1_DOC, status };
      expect(row(document, 'm1')).toBe(originalRow(document));
      expect(row(document, null)).toBe(originalRow(document));
    }
    expect(text(row({ ...M1_DOC, status: 'failed' }, 'm1'))).toBe('brand doc 01234567 · failed Failed');
  });

  it('keeps the old labels while the engine is unknown, even for a rehaul source', () => {
    expect(text(row(PAUSED, null))).toBe('board pack.pdf abcdef01 · uploaded Processing');
  });

  it('offers no delete and no reprocess under ke', () => {
    expect(footer(PAUSED, 'ke')).toBe('');
    expect(footer(PAUSED, null)).toBe('');
  });

  it('keeps Remove and Reprocess under M1', () => {
    const words = text(footer(M1_DOC, 'm1'));
    expect(words).toBe('Remove Reprocess');
    expect(text(footer(M1_DOC, null))).toBe('Remove Reprocess');
  });
});

describe('View usage beside a source paused by its limit (spec §7.4)', () => {
  const PAUSED_LIMITED: ServerDocument = { ...PAUSED, knowledge: { ...PAUSED.knowledge!, usage_limited: true } };
  const withLink = (document: ServerDocument, engine: Engine) =>
    renderToStaticMarkup(createElement(ServerSourceRow, { document, engine, onOpen: noop, onViewUsage: noop }));
  const footerWithLink = (document: ServerDocument, engine: Engine) =>
    renderToStaticMarkup(createElement(ServerSourceFooter, { document, engine, busy: false, onRemove: noop, onReprocess: noop, onViewUsage: noop }));

  it('shows on the row and in the popup under ke', () => {
    expect(text(withLink(PAUSED_LIMITED, 'ke'))).toMatch(/View usage$/);
    expect(text(footerWithLink(PAUSED_LIMITED, 'ke'))).toBe('View usage');
  });

  it('is absent when the source is not limited, when Settings cannot be opened, or under M1', () => {
    expect(text(withLink(PAUSED, 'ke'))).not.toContain('View usage');
    expect(text(row(PAUSED_LIMITED, 'ke'))).not.toContain('View usage');
    expect(text(withLink(PAUSED_LIMITED, null))).not.toContain('View usage');
    expect(withLink(M1_DOC, 'm1')).toBe(originalRow(M1_DOC));
    expect(text(footerWithLink(M1_DOC, 'm1'))).toBe('Remove Reprocess');
    expect(footerWithLink(PAUSED, 'ke')).toBe('');
  });
});

describe("the operator's detail actions", () => {
  const actions = (knowledgeEngine: boolean) =>
    text(renderToStaticMarkup(createElement(SourceDetailActions, { knowledgeEngine, busy: false, disabled: false, onReprocess: noop, onRemove: noop })));

  it('offer no reprocess under ke', () => {
    expect(actions(true)).toBe('Stop processing');
  });

  it('keep Reprocess document and Remove source under M1', () => {
    expect(actions(false)).toBe('Reprocess document Remove source');
  });
});

describe("the operator's source removal", () => {
  const button = (knowledgeEngine: boolean) =>
    text(renderToStaticMarkup(createElement(RemoveSourceButton, { knowledgeEngine, disabled: false, onClick: noop })));
  const confirm = (knowledgeEngine: boolean) =>
    text(renderToStaticMarkup(createElement(RemoveSourceConfirm, { knowledgeEngine, busy: false, error: null, onConfirm: noop, onCancel: noop })));

  it('is "Stop processing" under ke, and says the file is kept', () => {
    expect(button(true)).toBe('Stop processing');
    const words = confirm(true);
    expect(words).toContain('Stop processing this source?');
    expect(words).toContain('The file is kept');
    expect(words).toContain('This does not delete the file.');
    expect(words).not.toContain('Remove source');
  });

  it('is "Remove source" with today\'s copy under M1', () => {
    expect(button(false)).toBe('Remove source');
    const words = confirm(false);
    expect(words).toContain('Remove this source?');
    expect(words).toContain('This removes the source and its extracted knowledge from future generation.');
    expect(words).toContain('Keep source');
    expect(words).not.toContain('Stop processing');
  });
});
