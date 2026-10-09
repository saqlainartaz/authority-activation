import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { foldEvent, IDLE_TURN } from '@/components/compose/useAgentTurn';
import { phaseForChat } from '@/components/compose/useChatSession';
import { approachingCopy, limitRefusalCopy } from '@/lib/limit-refusal';
import type { KeUsage } from '@/lib/usage';
import ComposerNotices from '@/refined/ComposerNotices';
import UsageSection, { UsagePanel } from '@/refined/UsagePanel';
import { loadUsage, type UsageState } from '@/refined/usage-display';

/**
 * Cycle 5 P2.6 (spec 10A.3-10A.4, A41, A47): Settings -> Usage in each state,
 * and the composer's two limit notices, rendered as the client sees them.
 */

const render = (state: UsageState) => renderToStaticMarkup(createElement(UsagePanel, { state }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const DAY_RESET = '2026-10-06T00:00:00+00:00';
const MONTH_RESET = '2026-11-01T00:00:00+00:00';
const FULL: KeUsage = {
  engine: 'ke',
  uploads: { month: '2026-10', base: 20, extra: 10, used: 18, remaining: 12, unlimited: false, resets_at: MONTH_RESET },
  writing: {
    today: { used_fraction: 1, available: false, resets_at: DAY_RESET },
    month: { used_fraction: 0.85, available: true, resets_at: MONTH_RESET },
  },
  documents: { today: { used_fraction: 0.05, available: true, resets_at: DAY_RESET } },
};

const M1_COPY = 'Usage balance is not reported by the previous backend';

describe('Settings -> Usage', () => {
  it('shows uploads and three percentage bars with UTC resets under the rehaul engine', () => {
    const html = render({ kind: 'ke', usage: FULL });
    const words = text(html);
    expect(words).toContain('18 of 30 uploads used this month · 12 left');
    expect(words).toContain('Resets 1 November, 00:00 UTC');
    expect(words).toContain('Writing today 100% used');
    expect(words).toContain('Limit reached · resets 00:00 UTC');
    expect(words).toContain('Writing this month 85% used');
    expect(words).toContain('Nearly used up · resets 1 November, 00:00 UTC');
    expect(words).toContain('Document processing today 5% used');
    expect(html.match(/<progress/g)).toHaveLength(3);
    expect(html).toContain('value="85" max="100"');
    expect(words).not.toMatch(/\$|USD/);
    expect(words).not.toContain(M1_COPY);
  });

  it('shows null figures as unavailable, never as 0', () => {
    const html = render({
      kind: 'ke',
      usage: {
        ...FULL,
        uploads: { ...FULL.uploads, base: null, extra: null, remaining: null, unlimited: false },
        writing: {
          today: { used_fraction: null, available: false, resets_at: DAY_RESET },
          month: { used_fraction: null, available: false, resets_at: MONTH_RESET },
        },
        documents: { today: { used_fraction: null, available: false, resets_at: DAY_RESET } },
      },
    });
    const words = text(html);
    expect(words).toContain("Uploads aren't set up for this account yet");
    expect(words.match(/Not available/g)).toHaveLength(3);
    expect(html).not.toContain('<progress');
    expect(words).not.toMatch(/\b0%|\b0 of\b|Limit reached/);
  });

  it('shows only the copy it always showed under M1 (A47)', () => {
    const html = render({ kind: 'm1' });
    const words = text(html);
    expect(words).toBe(
      '— Usage balance is not reported by the previous backend No plan or quota has been invented. '
      + 'What counts as a generation Provider usage is recorded server-side when available; this backend exposes no client quota endpoint.',
    );
    expect(words).not.toMatch(/Writing|Uploads|UTC|%/);
  });

  it("says usage isn't available when the read fails, with no figures", async () => {
    const state = await loadUsage(async () => { throw new Error('503 usage_unavailable'); });
    const html = render(state);
    expect(text(html)).toBe("Usage isn't available right now");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('<progress');
    expect(text(html)).not.toMatch(/\d/);
  });

  it('shows the old copy at once under M1, with no loading state and no read (A47)', () => {
    const html = renderToStaticMarkup(createElement(UsageSection, { engine: 'm1' }));
    expect(text(html)).toContain(M1_COPY);
    expect(text(html)).not.toMatch(/Loading|isn't available/);
  });

  it('shows the old copy, and nothing new, while the engine is unknown (review M5)', () => {
    // Changed expectation (P2.9): this rendered nothing, so the M1 Usage tab was blank
    // whenever the engine could not be read.
    const html = renderToStaticMarkup(createElement(UsageSection, { engine: null }));
    expect(html).toBe(renderToStaticMarkup(createElement(UsageSection, { engine: 'm1' })));
    expect(text(html)).toContain(M1_COPY);
    expect(text(html)).not.toMatch(/Loading|isn't available|%/);
  });

  it('starts a live read under the rehaul engine', () => {
    expect(text(renderToStaticMarkup(createElement(UsageSection, { engine: 'ke' })))).toBe('Loading usage…');
  });

  it('shows a loading state before the figures arrive', () => {
    expect(text(render({ kind: 'loading' }))).toBe('Loading usage…');
  });
});

describe("the composer's limit notices", () => {
  const notices = (usageNotice: string | null, agentNotice: string | null) =>
    renderToStaticMarkup(createElement(ComposerNotices, { usageNotice, agentNotice }));

  it('shows the approaching notice from the stream event while the reply goes ahead', () => {
    const turn = foldEvent({ ...IDLE_TURN, status: 'streaming' }, { type: 'usage.approaching', resets_at: DAY_RESET, meter: 'writing_daily' });
    const html = notices(approachingCopy(turn.approachingResetsAt!, turn.approachingMeter), null);
    expect(html).toContain('role="status"');
    expect(text(html)).toBe("You've used most of today's writing budget. It resets at 00:00 UTC.");
    expect(html).not.toContain('role="alert"');
  });

  it("names this month's budget when the stream says the monthly meter binds", () => {
    const turn = foldEvent({ ...IDLE_TURN, status: 'streaming' }, { type: 'usage.approaching', resets_at: MONTH_RESET, meter: 'writing_monthly' });
    expect(text(notices(approachingCopy(turn.approachingResetsAt!, turn.approachingMeter), null)))
      .toBe("You've used most of this month's writing budget. It resets on 1 November at 00:00 UTC.");
  });

  it('shows the named limit, as an alert like every terminal sentence, when a reply is refused', () => {
    const explanation = limitRefusalCopy({
      meter: 'writing_monthly', period: 'month', used_fraction: 1, resets_at: MONTH_RESET, reason: 'budget_exhausted',
    });
    const turn = foldEvent(foldEvent({ ...IDLE_TURN, status: 'streaming' }, { type: 'terminal', outcome: 'refused', explanation }), { type: 'turn.end' });
    const phase = phaseForChat(null, null, false, turn);
    expect(phase.kind).toBe('terminal');
    const html = notices(null, phase.kind === 'terminal' ? phase.reason : null);
    expect(html).toContain('role="alert"');
    expect(text(html)).toBe('This month\'s writing limit is reached. It resets on 1 November at 00:00 UTC.');
    expect(text(html)).not.toMatch(/try again/i);
  });

  it('shows nothing when there is nothing to say (M1, or below 80%)', () => {
    expect(notices(null, null)).toBe('');
  });
});

describe("the composer's new-post suggestion (Cycle 5, P4.4)", () => {
  const SUGGESTION = 'Starting a new post keeps your guidance and recent posts.';
  const actions = () => ({ onStart: vi.fn(), onDismiss: vi.fn() });

  it('shows the suggestion as a quiet status line with New post and a dismiss, once the stream says the session is long', () => {
    const turn = foldEvent({ ...IDLE_TURN, status: 'streaming' }, { type: 'session.long' });
    const html = renderToStaticMarkup(createElement(ComposerNotices, {
      usageNotice: null, agentNotice: null, newPost: turn.sessionLong ? actions() : null,
    }));
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
    expect(text(html)).toBe(`${SUGGESTION} New post`);
    expect(html).toContain('aria-label="Dismiss"');
  });

  it('shows nothing for a session that is not long', () => {
    const turn = foldEvent({ ...IDLE_TURN, status: 'streaming' }, { type: 'turn.end' });
    const html = renderToStaticMarkup(createElement(ComposerNotices, {
      usageNotice: null, agentNotice: null, newPost: turn.sessionLong ? actions() : null,
    }));
    expect(html).toBe('');
  });

  it("wires New post to the workspace's own New post action and the dismiss to its dismissal", () => {
    const wired = actions();
    const buttons: Array<{ props: { onClick?: () => void; 'aria-label'?: string; children?: unknown } }> = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!isValidElement(node)) return;
      const props = node.props as { onClick?: () => void; children?: unknown };
      if (props.onClick) buttons.push(node as never);
      walk(props.children);
    };
    walk(ComposerNotices({ usageNotice: null, agentNotice: null, newPost: wired }));

    buttons.find(button => button.props.children === 'New post')!.props.onClick!();
    expect(wired.onStart).toHaveBeenCalledTimes(1);
    expect(wired.onDismiss).not.toHaveBeenCalled();
    buttons.find(button => button.props['aria-label'] === 'Dismiss')!.props.onClick!();
    expect(wired.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('sits beside the approaching notice without replacing it', () => {
    const html = renderToStaticMarkup(createElement(ComposerNotices, {
      usageNotice: "You've used most of today's writing budget. It resets at 00:00 UTC.", agentNotice: null, newPost: actions(),
    }));
    expect(html.match(/role="status"/g)).toHaveLength(2);
    expect(text(html)).toContain(SUGGESTION);
  });
});
