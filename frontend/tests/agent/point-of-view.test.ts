import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const AGENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'agent');
const instructions = fs.readFileSync(path.join(AGENT, 'instructions.md'), 'utf8');
const flat = instructions.replace(/\s+/g, ' ');

describe('whose voice a post is written in', () => {
  it('ships as a new instructions version', () => {
    expect(instructions).toMatch(/^---\r?\nversion: 1\.6\.0\r?\n/);
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
