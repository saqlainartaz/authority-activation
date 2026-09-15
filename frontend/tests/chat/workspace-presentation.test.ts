import { describe, expect, it } from 'vitest';
import { TEMPLATES } from '@/shared/data';

import {
  assembleWorkspaceConversation,
  newPostConfirmationKind,
  settledWorkspacePhase,
  showsConversation,
  showsDraft,
} from '@/refined/workspace-presentation';

describe('workspace presentation states', () => {
  it('shows the writing starter only before a conversation exists', () => {
    expect(showsConversation('empty', 0)).toBe(false);
    expect(showsConversation('reading', 1)).toBe(true);
    expect(showsConversation('streaming', 1)).toBe(true);
  });

  it('keeps a clarification-only conversation open after the turn becomes idle', () => {
    expect(showsConversation('empty', 2)).toBe(true);
  });

  it('offers New post before a draft exists and uses conversation wording', () => {
    expect(newPostConfirmationKind('empty', 0, false)).toBeNull();
    expect(newPostConfirmationKind('empty', 2, false)).toBe('conversation');
    expect(newPostConfirmationKind('record', 2, true)).toBe('draft');
  });

  it('uses complete discovery instructions rather than fragment template labels', () => {
    expect(TEMPLATES).toHaveLength(4);
    for (const template of TEMPLATES) {
      expect(template.starter.trim()).toMatch(/\.$/);
      expect(template.starter).toMatch(/write a LinkedIn post/i);
      expect(template.starter).toMatch(/choose|strongest|find/i);
    }
  });

  it('does not present connected streamed prose as a draft before draft.ready', () => {
    expect(showsDraft('streaming', false, false)).toBe(false);
  });

  it('shows only persisted connected drafts while retaining the demo animation', () => {
    expect(showsDraft('record', true, false)).toBe(true);
    expect(showsDraft('streaming', true, false)).toBe(true);
    expect(showsDraft('streaming', false, true)).toBe(true);
  });

  it('settles a clarification turn into chat without pretending it has a draft', () => {
    expect(settledWorkspacePhase(false)).toBe('empty');
    expect(settledWorkspacePhase(true)).toBe('record');
  });

  it('keeps the pending user message ahead of its streamed assistant reply', () => {
    const conversation = assembleWorkspaceConversation(
      [
        { role: 'user', body: 'Earlier request' },
        { role: 'assistant', body: 'Earlier reply' },
      ],
      ['How do I do it?'],
      'What should the post be about?',
    );
    expect(conversation).toEqual([
      { who: 'u', text: 'Earlier request' },
      { who: 'a', text: 'Earlier reply', text2: '', strong: '' },
      { who: 'u', text: 'How do I do it?' },
      { who: 'a', text: 'What should the post be about?', text2: '', strong: '' },
    ]);
  });

  it('does not duplicate the authoritative assistant message after refresh', () => {
    expect(assembleWorkspaceConversation(
      [{ role: 'assistant', body: 'What should the post be about?' }],
      [],
      'What should the post be about?',
    )).toHaveLength(1);
  });
});
