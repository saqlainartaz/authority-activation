import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GlobalNav, MobileNavRows } from '@/app/internal/global-nav';
import { SystemHealthView } from '@/app/internal/system-health';
import { healthReducer, INITIAL_HEALTH, type HealthState } from '@/app/internal/system-health-display';
import type { OpsHealth } from '@/lib/ops-health';
import { CLIENT_A, CLIENT_B, CLIENTS, DOC_HELD, deploymentBinding, opsHealth, withUnavailable } from '../client/ops-health-fixture';

/**
 * Cycle 5 P3.3 (spec §10.1, A31-A33, A39): the operator System health page,
 * rendered from a state, and the console's global navigation.
 */

const render = (state: HealthState) => renderToStaticMarkup(createElement(SystemHealthView, { state, clients: CLIENTS }));
const loaded = (data: OpsHealth): HealthState => healthReducer(INITIAL_HEALTH, { type: 'loaded', data });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
/** The markup of one section, by its heading id. */
const section = (html: string, id: string) => {
  const start = html.lastIndexOf('<section', html.indexOf(`aria-labelledby="${id}"`));
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
};

const SECTIONS = [
  ['health-workers', 'Workers'],
  ['health-documents', 'Documents added in the last 24 hours'],
  ['health-waiting', 'Waiting over one hour'],
  ['health-needs-person', 'Needs a person'],
  ['health-spend', "Today's AI spend"],
] as const;

describe('System health page', () => {
  it('renders an all-ok page: observation time, the five sections in the spec order, names and links', () => {
    const html = render(loaded(opsHealth()));
    const words = text(html);
    expect(words).toContain('Observed 7 Oct 2026, 09:00 UTC');
    const positions = SECTIONS.map(([id]) => html.indexOf(`id="${id}"`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const [, title] of SECTIONS) expect(words).toContain(title);
    expect(words).not.toContain('Unavailable');
    expect(words).not.toContain("Couldn't refresh");

    const workers = text(section(html, 'health-workers'));
    expect(workers).toContain('Every expected lane has a live worker');
    expect(workers).toContain('Replaced by a newer worker (2)');
    expect(section(html, 'health-workers')).toMatch(/<details[^>]*><summary>Replaced by a newer worker \(2\)<\/summary>/);

    const documents = text(section(html, 'health-documents'));
    expect(documents).toContain('Added between 6 Oct 2026, 09:00 UTC and 7 Oct 2026, 09:00 UTC (rolling 24 hours)');
    expect(documents).toMatch(/Finished 5 Still processing 2 Failed 1 Deleted or replaced 1/);

    const waiting = section(html, 'health-waiting');
    expect(waiting.match(/data-wait-kind="person"/g)).toHaveLength(1);
    expect(waiting.match(/data-wait-kind="limit"/g)).toHaveLength(1);
    expect(waiting.match(/data-wait-kind="retry"/g)).toHaveLength(1);
    expect(text(waiting)).toContain('Progress unknown');
    expect(text(waiting)).toContain('Client 99999999');

    const needs = text(section(html, 'health-needs-person'));
    expect(needs).toContain('Authorize the spend Operator');
    expect(needs).toContain('Split the file Client');
    expect(needs).toContain('Technical support');

    const spend = section(html, 'health-spend');
    expect(text(spend)).toContain('UTC accounting day 7 Oct 2026 · resets 8 Oct 2026, 00:00 UTC · currency USD');
    expect(text(spend)).toContain('Unknown costs: at least under US$0.01 (2 calls, reconciliation required)');
    expect(text(spend)).toContain('Deployment-wide daily safeguard');
    expect(spend).toContain(`href="/internal?client=${CLIENT_A}&amp;module=limits"`);
    expect(spend).toContain(`href="/internal?client=${CLIENT_B}&amp;module=limits"`);
    expect(text(spend)).toContain('Juniper Studio');
  });

  it('shows a repair after a roster change as its own wait, apart from a stall, and its re-run (P3.5)', () => {
    const data = opsHealth();
    const stalled = data.sections.waiting.rows!.find((row) => row.reason_class === 'no_progress')!;
    data.sections.waiting.rows!.push({
      ...stalled, issue_id: '155e0006-0000-5000-8000-000000000006', item_id: 'd0c0e1d0-0000-4000-8000-000000000006',
      document_id: 'd0c0e1d0-0000-4000-8000-000000000006', reason_class: 'repair_reextraction',
    });
    data.sections.needs_person.rows!.push({
      ...data.sections.needs_person.rows![2], issue_id: '155e0007-0000-5000-8000-000000000007',
      item_kind: 'extraction', item_id: 'd0c0e1d0-0000-4000-8000-000000000007',
      document_id: 'd0c0e1d0-0000-4000-8000-000000000007', function: 'operator', action_class: 'rerun_repair',
      reason_class: 'capacity_exhausted',
    });
    const html = render(loaded(data));
    const waiting = section(html, 'health-waiting');
    expect(waiting.match(/data-wait-kind="repair"/g)).toHaveLength(1);
    expect(waiting.match(/data-wait-kind="stalled"/g)).toHaveLength(1);
    expect(text(waiting)).toContain('Updating after a roster change');
    expect(text(waiting)).toContain('No recorded progress');
    const repairItem = waiting.slice(waiting.indexOf('data-wait-kind="repair"'));
    expect(repairItem.slice(0, repairItem.indexOf('</li>'))).not.toContain('No recorded progress');
    expect(text(section(html, 'health-needs-person'))).toContain(
      'Re-run the roster repair (ke_repair_stale_releases.py) Operator');
  });

  it('has no restart, bulk or destructive action (spec §10.1)', () => {
    const html = render(loaded(opsHealth()));
    const buttons = html.match(/<button[^>]*>.*?<\/button>/g) ?? [];
    expect(buttons.map(text)).toEqual(['Refresh']);
    // "Deleted or replaced" is a document count, not an action.
    expect(text(html)).not.toMatch(/\b(Restart|Delete|Retry all|Release|Remove|Cancel)\b/);
  });

  it('shows an unavailable section as "Unavailable — <class>", never an empty list or a 0 count', () => {
    for (const [name, id] of [['workers', 'health-workers'], ['documents_24h', 'health-documents'], ['waiting', 'health-waiting'], ['needs_person', 'health-needs-person'], ['spend', 'health-spend']] as const) {
      const html = render(loaded(withUnavailable(name, 'RaiseException')));
      const unavailable = section(html, id);
      expect(text(unavailable), name).toBe(`${SECTIONS.find(([key]) => key === id)![1]} Unavailable — RaiseException`);
      expect(unavailable).not.toContain('<ul');
      expect(unavailable).not.toContain('<dl');
      // The other four sections still show.
      expect(text(html).match(/Unavailable/g), name).toHaveLength(1);
    }
  });

  it('keeps the last good data after a failed refresh and marks it stale', () => {
    const state = healthReducer(loaded(opsHealth()), { type: 'failed', message: 'Something broke on our side.' });
    const html = render(state);
    const words = text(html);
    expect(words).toContain("Couldn't refresh · showing data from 7 Oct 2026, 09:00 UTC");
    expect(html).toMatch(/role="alert"[^>]*>Couldn&#x27;t refresh/);
    for (const [id] of SECTIONS) expect(html).toContain(`id="${id}"`);
    expect(words).toContain('Finished 5');
  });

  it('shows an error, not a page of zeros, when nothing could be read', () => {
    const words = text(render(healthReducer(INITIAL_HEALTH, { type: 'failed', message: 'down' })));
    expect(words).toContain('System health could not be read: down');
    expect(words).not.toMatch(/Finished|\b0\b/);
  });

  it('shows a waiting document and its needs-person row as one issue, with the same marker in both', () => {
    const html = render(loaded(opsHealth()));
    const marker = `Same issue · ${DOC_HELD.slice(0, 8)}`;
    expect(section(html, 'health-waiting')).toContain(marker);
    expect(section(html, 'health-needs-person')).toContain(marker);
    expect(html.match(new RegExp(`>${marker}<`, 'g'))).toHaveLength(2);
    // Each links to the other.
    expect(section(html, 'health-waiting')).toContain(`href="#needs-document-${DOC_HELD}"`);
    expect(section(html, 'health-needs-person')).toContain(`href="#waiting-document-${DOC_HELD}"`);
  });

  it('under the deployment limit, every client row names the deployment, never its own budget (A39, Ruling 50)', () => {
    const spend = text(section(render(loaded(deploymentBinding())), 'health-spend'));
    expect(spend.match(/the deployment's daily limit is reached \(not this client's budget\)/g)).toHaveLength(6);
    expect(spend).not.toContain('Can run paid work');
    expect(spend).not.toContain("This client's budget is used up");
  });
});

describe('Retry delete (Ruling 93)', () => {
  const STUCK = '5d1e7e00-0000-4000-8000-000000000093';
  const STUCK_DOC = 'd0c0e1d0-0000-4000-8000-000000000093';
  const withStuckDelete = (): OpsHealth => {
    const data = opsHealth();
    data.sections.needs_person.rows = [...(data.sections.needs_person.rows ?? []), {
      issue_id: '155e0093-0000-5000-8000-000000000093', client_id: CLIENT_A, item_kind: 'source_lifecycle_request',
      item_id: STUCK, document_id: STUCK_DOC, function: 'operator', action_class: 'restart_source_delete',
      reason_class: 'source_delete_not_finished', opened_at: '2026-10-07T06:00:00+00:00', age_seconds: 10800,
    }];
    return data;
  };
  const retryRender = (onRetryDelete?: () => Promise<void>) => renderToStaticMarkup(createElement(SystemHealthView, {
    state: loaded(withStuckDelete()), clients: CLIENTS, onRetryDelete,
  }));

  it('shows Retry delete on the stuck Delete file row only', () => {
    const needs = section(retryRender(async () => {}), 'health-needs-person');
    expect(needs.match(/data-retry-delete=/g)).toHaveLength(1);
    expect(needs).toContain(`data-retry-delete="${STUCK}"`);
    const words = text(needs);
    expect(words.match(/Retry delete/g)).toHaveLength(1);
    expect(words).toContain('File delete stopped — retry');
    expect(words).toContain('File delete stopped before it finished');
    // The row keeps its link to the client's Sources after the button.
    expect(text(needs.slice(needs.indexOf(`data-retry-delete="${STUCK}"`)))).toContain('Open Sources');
  });

  it('has no button without a handler (a pure render of the page)', () => {
    expect(retryRender()).not.toContain('data-retry-delete');
  });
});

describe('global navigation', () => {
  const nav = (rehaul: boolean) => renderToStaticMarkup(createElement(GlobalNav, {
    view: 'clients', creating: false, clientCount: 2, rehaul, onClients: () => {}, onHealth: () => {},
  }));
  const menu = (rehaul: boolean) => renderToStaticMarkup(createElement(MobileNavRows, { rehaul, onClients: () => {}, onHealth: () => {} }));

  it('has no System health entry under M1', () => {
    expect(text(nav(false))).toBe('Clients 2');
    expect(text(menu(false))).not.toContain('System health');
  });

  it('shows System health beside Clients on the rehaul engine', () => {
    expect(text(nav(true))).toBe('Clients 2 System health');
    expect(text(menu(true))).toContain('System health');
  });
});
