import { afterEach, describe, expect, it, vi } from 'vitest';

import { answerIntent, packetPosition, postAnswer, readAnswer, type AnswerIntent } from '@/refined/client-questions';

/**
 * Cycle 5 P6.6 (A08): an answer's intent key is minted in the browser once per
 * answer and reused when the same answer is sent again, so a lost reply never
 * records two answers. A different answer, or another question, gets a new key.
 */

let serial = 0;
const mint = () => `key-${++serial}`;

describe('answer intents', () => {
  it('reuses the key for a retry of the same answer', () => {
    const first = answerIntent(null, 'q-1', { disposition: 'answer', payload: { option: 'b' } }, mint);
    const retry = answerIntent(first, 'q-1', { disposition: 'answer', payload: { option: 'b' } }, mint);
    expect(retry).toBe(first);
  });

  it('mints a new key for another answer or another question', () => {
    const first = answerIntent(null, 'q-1', { disposition: 'answer', payload: { option: 'b' } }, mint);
    expect(answerIntent(first, 'q-1', { disposition: 'answer', payload: { option: 'a' } }, mint).key).not.toBe(first.key);
    expect(answerIntent(first, 'q-1', { disposition: 'skip' }, mint).key).not.toBe(first.key);
    expect(answerIntent(first, 'q-2', { disposition: 'answer', payload: { option: 'b' } }, mint).key).not.toBe(first.key);
  });
});

describe('the onboarding position', () => {
  it('is the first open question of the packet: "3 of 7"', () => {
    expect(packetPosition({ total: 7, remaining: 5 })).toEqual({ index: 3, total: 7 });
    expect(packetPosition({ total: 7, remaining: 7 })).toEqual({ index: 1, total: 7 });
    expect(packetPosition({ total: 0, remaining: 0 })).toBeNull();
    expect(packetPosition({ total: 4, remaining: 0 })).toBeNull();
  });
});

describe('sending an answer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the intent key and the answer, and reads what changed from the answer', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'a-1', what_changed: 'Added.' }), { status: url.endsWith('/answers') ? 201 : 200 });
    }));
    const intent: AnswerIntent = answerIntent(null, 'q-1', { disposition: 'defer' }, () => 'k-1');

    await postAnswer(intent);
    await readAnswer('a-1');

    expect(calls.map(call => [call.init?.method ?? 'GET', call.url])).toEqual([
      ['POST', '/api/client/questions/q-1/answers'], ['GET', '/api/client/questions/answers/a-1'],
    ]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ idempotency_key: 'k-1', disposition: 'defer' });
  });

  it('a failure keeps its status for the screen to act on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'That question was already answered.' }), { status: 409 })));
    await expect(postAnswer(answerIntent(null, 'q-1', { disposition: 'skip' }, () => 'k'))).rejects.toMatchObject({ status: 409, message: 'That question was already answered.' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(readAnswer('a-1')).rejects.toMatchObject({ status: 0 });
  });
});
