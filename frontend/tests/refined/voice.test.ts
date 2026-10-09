import { describe, expect, it } from 'vitest';

import { STALE_GUIDANCE_COPY, type GuidanceResult, type SavedGuidance } from '@/refined/guidance';
import {
  GENERAL_VOICE, initialCard, loadVoiceOptions, voiceController, voiceReducer,
  type VoiceCard, type VoiceOption,
} from '@/refined/voice';

/**
 * Cycle 5 P5.3 (spec 6; A13, A14, A16; Ruling 68): the voice card's flow, driven
 * through its real controller and reducer against a fake BFF. The rule above
 * the rest: NOTHING writes guidance until Save, and Save writes exactly the text
 * shown, as the one general guidance (D06), against the version read.
 *
 * Compare (A / B / Both / Neither, notes), the fact screen with Restore and a
 * voice's own guidance were removed as over-engineered, 2026-10-08; their tests
 * went with them.
 */

type Call = { url: string; method: string; body: Record<string, unknown> | null };

const AUTHOR = '8b1c1f8e-0000-4000-8000-000000000007';
const PERSON: VoiceOption = { key: `personal:${AUTHOR}`, label: 'Ada Lovelace (as yourself)', perspective: { mode: 'personal', authorId: AUTHOR } };
const GENERAL: SavedGuidance = { guidelineId: 'g-general', revision: 2, text: 'General.' };

/** A fake BFF: the voice route answers like the stub driver; anything else is recorded. */
function bff(options: { voiceOutcome?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  let version = 0;
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    calls.push({ url, method: init.method ?? 'GET', body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (url === '/api/client/voice') {
      if (options.voiceOutcome) return json(options.voiceOutcome);
      version += 1;
      const kind = body?.kind;
      return json({
        outcome: 'preview',
        preview_id: body?.preview_id,
        sample: kind === 'adjust' ? `Revised ${version}: ${body?.instruction}` : `Sample ${version}`,
        proposed_guidance: kind === 'adjust' ? `- ${body?.instruction}` : `- Guidance ${version}`,
        starting_proposal: true,
        approaching: null,
      });
    }
    if (url === '/api/client/writing-perspectives') {
      return json({ authors: [{ ref: { kind: 'entity', id: AUTHOR, revision: 1 }, label: 'Ada Lovelace' }], brands: [] });
    }
    return json({ error: 'not stubbed' }, 404);
  };
  return { calls, fetcher };
}

/** The card with a real reducer, and the general setting's own save path. */
function card(fake: ReturnType<typeof bff>, general: SavedGuidance | null = null, saveStatus: 'saved' | 'stale' = 'saved') {
  let state: VoiceCard = initialCard(GENERAL_VOICE, general);
  const generalSaves: Array<{ draft: string; base: SavedGuidance | null }> = [];
  let ids = 0;
  const controller = voiceController(
    { get: () => state, dispatch: action => { state = voiceReducer(state, action); } },
    {
      fetcher: fake.fetcher,
      saveGeneral: async (draft, base): Promise<GuidanceResult> => {
        generalSaves.push({ draft, base });
        if (saveStatus === 'stale') return { kind: 'stale' };
        return { kind: 'saved', saved: { guidelineId: 'g-general', revision: (base?.revision ?? 0) + 1, text: draft } };
      },
      reloadGeneral: async () => ({ kind: 'saved', saved: general }),
      newId: () => `0000000${++ids}-0000-4000-8000-000000000000`,
      onSignedOut: () => { throw new Error('signed out'); },
    },
  );
  return { controller, generalSaves, state: () => state };
}

const settingsCalls = (calls: Call[]) => calls.filter(call => call.url.startsWith('/api/client/writing-settings'));

describe('the voice card flow', () => {
  it('offers General plus each permitted author and brand', async () => {
    const options = await loadVoiceOptions(bff().fetcher);
    expect(options.map(option => option.key)).toEqual(['general', `personal:${AUTHOR}`]);
    expect(options[1].label).toBe('Ada Lovelace (as yourself)');
  });

  it('generate shows a sample; Use this voice shows its guidance to edit and saves nothing', async () => {
    const fake = bff();
    const { controller, state, generalSaves } = card(fake);

    await controller.generate();
    expect(state().version).toMatchObject({ sample: 'Sample 1', startingProposal: true });
    expect(state().guidanceDraft).toBeNull();

    controller.use(state().version!);
    expect(state().guidanceDraft).toBe('- Guidance 1');
    expect(settingsCalls(fake.calls)).toEqual([]);
    expect(generalSaves).toEqual([]);
  });

  it('A14: Adjust and Use make no writing-settings call at all before an explicit Save', async () => {
    const fake = bff();
    const { controller, state, generalSaves } = card(fake);

    await controller.generate();
    controller.adjustOpen();
    controller.adjustText('warmer, fewer emojis');
    await controller.adjust();
    // The revision and its guidance appear before any save.
    expect(state().version?.sample).toBe('Revised 2: warmer, fewer emojis');
    expect(state().guidanceDraft).toBe('- warmer, fewer emojis');

    controller.editGuidance('- warmer, fewer emojis\n- end with a question');
    expect(settingsCalls(fake.calls)).toEqual([]);
    expect(generalSaves).toEqual([]);

    // Each generation had its own preview id.
    const ids = fake.calls.filter(call => call.url === '/api/client/voice').map(call => call.body?.preview_id);
    expect(new Set(ids).size).toBe(2);

    await controller.save();
    expect(generalSaves).toEqual([{ draft: '- warmer, fewer emojis\n- end with a question', base: null }]);
    expect(state().savedText).toBe('- warmer, fewer emojis\n- end with a question');
  });

  it('Save in any voice writes the shown text exactly as the one general guidance, against the version read (D06)', async () => {
    const fake = bff();
    const { controller, state, generalSaves } = card(fake, GENERAL);

    controller.choose(PERSON);
    expect(state().base).toEqual(GENERAL);
    await controller.generate();
    controller.use(state().version!);
    controller.editGuidance('- Short.\n\n  - Indented bullet.');

    await controller.save();

    expect(generalSaves).toEqual([{ draft: '- Short.\n\n  - Indented bullet.', base: GENERAL }]);
    expect(state().savedText).toBe('- Short.\n\n  - Indented bullet.');
    // Choosing a voice reads no voice-specific guidance: there is none.
    expect(settingsCalls(fake.calls)).toEqual([]);
    // The sample was still written in the chosen voice.
    const [request] = fake.calls.filter(call => call.url === '/api/client/voice').map(call => call.body);
    expect(request).toMatchObject({ perspective: { mode: 'personal', author_id: AUTHOR } });
  });

  it('a stale save shows the P5.1 prompt and keeps the text; Reload clears it', async () => {
    const fake = bff();
    const { controller, state } = card(fake, GENERAL, 'stale');
    await controller.generate();
    controller.use(state().version!);

    await controller.save();
    expect(state()).toMatchObject({ stale: true, guidanceDraft: '- Guidance 1', savedText: null });
    expect(STALE_GUIDANCE_COPY).toContain('changed somewhere else');

    await controller.reload();
    expect(state().stale).toBe(false);
    expect(state().guidanceDraft).toBe('- Guidance 1');
  });

  it('a reserve refusal (nothing held) retries under the same id; every other failure under a new one (Ruling 69)', async () => {
    const refused = bff({ voiceOutcome: { outcome: 'refused', message: "Today's writing limit is reached. It resets at 00:00 UTC.", retry: 'same' } });
    const a = card(refused);
    await a.controller.generate();
    expect(a.state().message).toBe("Today's writing limit is reached. It resets at 00:00 UTC.");
    await a.controller.retry();
    const ids = refused.calls.filter(call => call.url === '/api/client/voice').map(call => call.body?.preview_id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);

    // A failed run, a refusal after a hold (fail closed), a 5xx and a network
    // error: each retry is a new attempt with a new id.
    const answers: Array<() => Response> = [
      () => Response.json({ outcome: 'failed', message: 'Generate again.', retry: 'new' }),
      () => Response.json({ outcome: 'refused', message: 'Not started.', retry: 'new' }),
      () => Response.json({ error: 'Bad gateway' }, { status: 502 }),
      () => { throw new TypeError('network down'); },
    ];
    for (const answer of answers) {
      const sent: string[] = [];
      const failing = async (url: string, init: RequestInit = {}) => {
        if (url === '/api/client/voice') sent.push(String(JSON.parse(String(init.body)).preview_id));
        return answer();
      };
      const b = card({ calls: [], fetcher: failing as never });
      await b.controller.generate();
      expect(b.state().message).not.toBeNull();
      await b.controller.retry();
      expect(sent).toHaveLength(2);
      expect(sent[1]).not.toBe(sent[0]);
    }
  });

  it('Start again stores nothing', async () => {
    const fake = bff();
    const { controller, state, generalSaves } = card(fake);
    await controller.generate();
    controller.use(state().version!);
    controller.reset();
    expect(state()).toMatchObject({ version: null, guidanceDraft: null });
    expect(settingsCalls(fake.calls)).toEqual([]);
    expect(generalSaves).toEqual([]);
  });

  it('the request carries the voice, the version worked from and the optional style note, and no guidance write', async () => {
    const fake = bff();
    const { controller, state } = card(fake);
    controller.style('  Dry, like my newsletter.  ');
    await controller.generate();
    controller.use(state().version!);
    controller.editGuidance('- edited');
    controller.adjustText('shorter');
    await controller.adjust();

    const [first, second] = fake.calls.filter(call => call.url === '/api/client/voice').map(call => call.body);
    expect(first).toEqual({ preview_id: expect.any(String), perspective: { mode: 'neutral' }, kind: 'generate', style_note: 'Dry, like my newsletter.' });
    // An adjustment starts from the version shown, with the client's edits.
    expect(second).toMatchObject({ kind: 'adjust', instruction: 'shorter', base: { sample: 'Sample 1', proposed_guidance: '- edited' } });
    expect(settingsCalls(fake.calls)).toEqual([]);
  });
});
