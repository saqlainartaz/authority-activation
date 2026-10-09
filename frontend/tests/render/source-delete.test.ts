import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Dialog } from '@/components/ui/dialog';
import { deletingStatus, knowledgeStatus } from '@/lib/knowledge-status';
import { DELETED_NOTICE } from '@/lib/source-switch';
import { DeletedNotice, ServerSourceRow } from '@/refined/KnowledgeSource';
import type { ServerDocument } from '@/refined/knowledge-view';
import { DELETE_FILE, DELETE_READ_FAILED, DeleteConfirmView, deleteConfirmNote, SourceDetails, SourcePopupActions } from '@/refined/SourcePopup';
import { UsagePanel } from '@/refined/UsagePanel';

/**
 * Cycle 5 P8.3: Delete file on the Knowledge screen, rendered.
 * - The popup offers Delete file to a signed-in member only (never to a link).
 * - "Delete this file?" says what goes, what stays, and that the upload counts.
 * - The row reads Deleting until the purge finishes, with no switch and no actions.
 * - The one-time notice, and the Usage line (D11).
 */

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const noop = () => undefined;

const AVAILABLE: ServerDocument = {
  id: '22222222-2222-4222-8222-222222222222', source_type: 'pricing notes.pdf', source_authority: 'CLIENT',
  status: 'atomised', created_at: '2026-10-06T09:00:00Z', filename: 'pricing notes.pdf', closed: false,
  knowledge: knowledgeStatus({ state: 'ready' }, { state: 'active', yield: 'evidence' }, []), labels: [],
  use: { state: 'on', requested: null, revision: 2 },
};
const DELETING: ServerDocument = { ...AVAILABLE, closed: true, use: null, deleting: true, knowledge: deletingStatus() };

const actions = (document: ServerDocument, onDelete?: () => void) =>
  text(renderToStaticMarkup(createElement(SourcePopupActions, { document, onDelete, onClose: noop })));

describe('Delete file in the source popup (P8.3, D05)', () => {
  it('is offered to a signed-in member', () => {
    expect(actions(AVAILABLE, noop)).toBe(`${DELETE_FILE} Close`);
  });

  it('is never offered to an onboarding link (no delete action is passed)', () => {
    expect(actions(AVAILABLE)).toBe('Close');
  });

  it('is not offered again for a file already being deleted', () => {
    expect(actions(DELETING, noop)).toBe('Close');
  });
});

describe('"Delete this file?" (P8.3)', () => {
  const confirm = (extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Dialog, { open: true },
    createElement(DeleteConfirmView, { name: 'pricing notes.pdf', busy: false, note: null, onCancel: noop, onConfirm: noop, ...extra })));

  it('says what is removed, what stays, that it is final, and that the upload still counts', () => {
    expect(text(confirm())).toBe(
      'Delete this file? “pricing notes.pdf” and its earlier versions, and everything learned only from them, will be '
      + "removed from your workspace. Saved posts stay as they are. This can't be undone, and the upload still counts "
      + "toward this month's allowance. Cancel Delete file",
    );
  });

  it('holds both buttons while the delete is being sent, and shows a refusal beside them', () => {
    const html = confirm({ busy: true, note: 'This source changed since you opened it. Its current setting is shown.' });
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons.every(button => button.includes(" disabled=\"\""))).toBe(true);
    expect(text(html)).toContain('This source changed since you opened it.');
  });

  it('says why Delete file cannot be pressed when the fresh read failed (P8 gate sweep, M-12)', () => {
    expect(deleteConfirmNote(null, true)).toBe(DELETE_READ_FAILED);
    expect(deleteConfirmNote(null, false)).toBeNull();
    expect(deleteConfirmNote('This file is being deleted.', true)).toBe('This file is being deleted.');
    const html = confirm({ busy: true, note: deleteConfirmNote(null, true) });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("We couldn't check this file. Close and reopen it to try again.");
  });
});

describe('a file being deleted (P8.3)', () => {
  it('reads Deleting in the list', () => {
    expect(text(renderToStaticMarkup(createElement(ServerSourceRow, { document: DELETING, engine: 'ke', onOpen: noop }))))
      .toBe('pricing notes.pdf PDF · 6 Oct 2026 Deleting');
  });

  it('has no switch and no question in its popup', () => {
    const words = text(renderToStaticMarkup(createElement(SourceDetails, {
      document: DELETING, engine: 'ke', use: null, busy: false, note: null, onToggle: noop })));
    expect(words).toContain('Status Deleting');
    expect(words).not.toContain('Use this source On');
    expect(words).not.toMatch(/Off keeps the file/);
  });

  it('is announced once when it has gone', () => {
    expect(text(renderToStaticMarkup(createElement(DeletedNotice, { onDismiss: noop })))).toBe(`${DELETED_NOTICE} Dismiss`);
    expect(DELETED_NOTICE).toBe('Deleted from your workspace now.');
  });
});

describe('Settings -> Usage (D11)', () => {
  it("says a delete doesn't give an upload back", () => {
    const reset = '2026-11-01T00:00:00+00:00';
    const words = text(renderToStaticMarkup(createElement(UsagePanel, { state: { kind: 'ke', usage: {
      engine: 'ke',
      uploads: { month: '2026-10', base: 20, extra: 0, used: 3, remaining: 17, unlimited: false, resets_at: reset },
      writing: { today: { used_fraction: 0, available: true, resets_at: reset }, month: { used_fraction: 0, available: true, resets_at: reset } },
      documents: { today: { used_fraction: 0, available: true, resets_at: reset } },
    } } })));
    expect(words).toContain("Uploads 3 of 20 uploads used this month · 17 left");
    expect(words).toContain("Deleting a file doesn't give back an upload.");
  });
});
