import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ClientDetail } from '@/app/internal/panels';
import type { KnowledgeStatus } from '@/lib/knowledge-status';
import { dnaViewFor } from '@/refined/BusinessDna';
import { usesQuestionStore } from '@/refined/client-questions';
import { voiceCardFor } from '@/refined/GuidancePanel';
import {
  coverageCards, offersSourceActions, showsKnowledgeStatus, showsSourceList, uploadNote, type ServerDocument,
} from '@/refined/knowledge-view';
import { onboardingFor } from '@/refined/Onboarding';
import UsageSection from '@/refined/UsagePanel';
import { usageSource, usageStateFrom, usageSubtitle } from '@/refined/usage-display';

/**
 * Cycle 5 P10.2 (plan review focus 2; spec A47): every Cycle 5 surface is hidden
 * when the deployment runs M1, and when the engine is not known (`null`: still
 * loading, or its read failed). The same decision shows it under the rehaul
 * engine, so each assertion is checked over both engines. The backend half is
 * `tests/test_both_engine_modes.py`; Playwright's M1 cases render the M1 pages.
 */

const WITHOUT_THE_NEW_ENGINE = ['m1', null] as const;
const STATUS = { label: 'Available', tone: 'ready' } as unknown as KnowledgeStatus;
const keDocument: ServerDocument = {
  id: 'd1', source_type: 'brand_doc', source_authority: 'client', status: 'uploaded',
  created_at: '2026-10-09T00:00:00Z', knowledge: STATUS, filename: 'menu.pdf',
};
const m1Document: ServerDocument = {
  id: 'd2', source_type: 'brand_doc', source_authority: 'client', status: 'atomised',
  created_at: '2026-10-09T00:00:00Z', atom_count: 3,
};
const componentName = (element: ReactElement) => (element.type as { name?: string }).name;
const internal = (section: 'overview' | 'sources', rehaul: boolean) => renderToStaticMarkup(createElement(ClientDetail, {
  clientId: '00000000-0000-4000-8000-000000000001',
  api: (async () => ({})) as never,
  section, onNavigate: () => {}, rehaul,
}));

describe.each(WITHOUT_THE_NEW_ENGINE)('engine %s: no Cycle 5 surface', engine => {
  it('shows no question screens, and onboarding is M1\'s', () => {
    expect(usesQuestionStore(false, engine)).toBe(false);
    expect(componentName(onboardingFor(false, engine))).toBe('M1Onboarding');
  });

  it('shows the M1 Business DNA questionnaire, not the inventory', () => {
    expect(dnaViewFor(false, engine)).toBe('questionnaire');
  });

  it('has no voice card', () => {
    expect(voiceCardFor(engine)).toBeNull();
  });

  it('shows the M1 source list: no status, search, labels, switch or Delete file; Remove and Reprocess stay', () => {
    expect(showsSourceList(engine, false)).toBe(false);
    expect(showsKnowledgeStatus(engine, keDocument)).toBe(false);
    expect(offersSourceActions(engine, m1Document)).toBe(true);
    expect(coverageCards([m1Document], engine).map(([title]) => title)).toEqual(['Sources', 'Learned', 'Needs attention']);
    expect(uploadNote(engine)).toContain('Learned');
  });

  it('keeps the M1 usage copy and never reads /v1/usage', () => {
    expect(usageSource(engine)).toBe('m1');
    expect(usageSubtitle(false, engine)).toBe('Generations left this month');
    const html = renderToStaticMarkup(createElement(UsageSection, { engine }));
    expect(html).not.toMatch(/Writing|Uploads this month|Loading usage/);
  });
});

describe('the internal console without the new engine', () => {
  it('has no Ready to onboard on the overview', () => {
    expect(internal('overview', false)).not.toMatch(/Onboarding questions|Ready to onboard/);
  });
});

describe('the rehaul engine: the same decisions show each surface', () => {
  it('turns every Cycle 5 surface on', () => {
    expect(usesQuestionStore(false, 'ke')).toBe(true);
    expect(componentName(onboardingFor(false, 'ke'))).toBe('KeOnboarding');
    expect(dnaViewFor(false, 'ke')).toBe('inventory');
    expect(isValidElement(voiceCardFor('ke'))).toBe(true);
    expect(showsSourceList('ke', false)).toBe(true);
    expect(showsKnowledgeStatus('ke', keDocument)).toBe(true);
    expect(usageSource('ke')).toBe('fetch');
    expect(usageSubtitle(false, 'ke')).toBe('Uploads and writing this month');
    expect(internal('overview', true)).toMatch(/Onboarding questions/);
  });

  it('the demo never shows the new engine\'s screens, whatever the engine', () => {
    expect(usesQuestionStore(true, 'ke')).toBe(false);
    expect(dnaViewFor(true, 'ke')).toBe('questionnaire');
    expect(showsSourceList('ke', true)).toBe(false);
  });

  it('reads an M1 usage answer as M1, and anything else as an error, never a guess', () => {
    expect(usageStateFrom({ engine: 'm1' })).toEqual({ kind: 'm1' });
    expect(usageStateFrom({}).kind).toBe('error');
  });
});
