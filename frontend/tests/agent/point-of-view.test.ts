import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'agent');
const instructions = fs.readFileSync(path.join(AGENT, 'instructions.md'), 'utf8');
const flat = instructions.replace(/\s+/g, ' ');

describe('whose voice a post is written in', () => {
  it('ships as a new instructions version', () => {
    // CHANGED EXPECTATION (C4 merged main, 2026-09-25): main shipped this rule
    // as 1.6.0 while C4 was at 1.7.0; the merged file carries both, so it is a
    // newer version than either. 1.8.1 (Cycle 5 P5 gate sweep, P4 review M-1):
    // the tag rules name <recent-posts> and <session-summary>. 1.9.0 (Cycle 5
    // P5.5, P5 review M-7): a fact is stated no more broadly than its source.
    expect(instructions).toMatch(/^---\r?\nversion: 1\.9\.0\r?\n/);
  });

  it('defaults every post, including one about the client\'s own business, to the person in the first person', () => {
    expect(flat).toContain('A post is written as the client, in the first person, by default.');
    expect(flat).toContain('That default holds when the post is about one of the client\'s own businesses or brands');
  });

  it('switches to a brand only when the client asks, without treating it as working for someone else', () => {
    expect(flat).toContain('Write as one of the client\'s own businesses only when the client asks for it');
    expect(flat).toContain('is still working for this client, not for anybody else');
    expect(flat).toContain('never "I"');
  });

  it('keeps the other entity to its relationship and resolves an unclear speaker to the person', () => {
    expect(flat).toContain('Mention the other only through its relationship');
    expect(flat).toContain('If the request does not say who should speak, write as the person.');
  });
});

describe('a fact is stated no more broadly than its source (Cycle 5 P5.5, P5 review M-7)', () => {
  const voicePrompt = fs.readFileSync(path.join(AGENT, 'prompts', 'voice-preview.md'), 'utf8');
  const flatVoice = voicePrompt.replace(/\s+/g, ' ');

  it.each([
    ['the writer instructions', flat],
    ['the voice preview prompt', flatVoice],
  ])('%s carry the rule: no added quantifier, no business fact as personal experience, no invented first-person experience', (_name, text) => {
    expect(text).toContain('State a fact no more broadly than its source');
    expect(text).toContain('("most", "all", "every", "always", "often")');
    expect(text).toContain("do not restate it as the person's own experience");
    expect(text).toContain('Invent no first-person experience');
  });

  it('the voice preview prompt ships as a new version and keeps handles out of the sample', () => {
    // 1.2.0 (2026-10-08): Compare and `stated_facts` removed with the fact screen.
    expect(voicePrompt).toMatch(/^---\r?\nversion: 1\.2\.0\r?\n/);
    expect(flatVoice).toContain('put no knowledge handles such as `[K1]` in it');
  });
});
