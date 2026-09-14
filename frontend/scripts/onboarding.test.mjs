import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = await readFile(new URL('../src/refined/setup-packets.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { PACKETS, OTHER, packetAnswer, setupComplete, advancesOnChoice, restoreSetup } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const complete = () => ({ completed: true, answers: Object.fromEntries(PACKETS.map(p => [p.id, { selected: p.options ? [p.options[0].label] : [], text: p.options ? '' : 'An answer in my words.' }])) });

test('all five packet types require an answer and typed alternatives cannot be blank', () => {
  assert.deepEqual(new Set(PACKETS.map(p => p.type)), new Set(['choice', 'pick_source', 'multi', 'short', 'long']));
  for (const p of PACKETS) {
    assert.equal(packetAnswer(p), null);
    assert.equal(packetAnswer(p, { selected: p.options ? [OTHER] : [], text: ' \n ' }), null);
    assert.deepEqual(packetAnswer(p, { selected: p.options ? [OTHER] : [], text: '  Ask our operations lead.  ' }), ['Ask our operations lead.']);
  }
});
test('multi keeps chosen services and the written answer together', () => {
  const p = PACKETS.find(p => p.type === 'multi');
  assert.deepEqual(packetAnswer(p, { selected: ['Payroll', OTHER], text: 'Recruiting' }), ['Payroll', 'Recruiting']);
});
test('review completion requires every packet and remains false after an answer is cleared', () => {
  const setup = complete();
  assert.equal(setupComplete(setup), true);
  setup.answers.company.text = '';
  assert.equal(setupComplete(setup), false);
  assert.equal(restoreSetup(setup).completed, false);
});
test('only explicit single choices advance; custom, multi and written answers stay put', () => {
  for (const packet of PACKETS) {
    assert.equal(advancesOnChoice(packet, OTHER), false);
    assert.equal(advancesOnChoice(packet, 'Unknown option'), false);
    for (const option of packet.options || []) assert.equal(advancesOnChoice(packet, option.label), ['choice', 'pick_source'].includes(packet.type));
  }
});
test('removed follow-up flags are discarded while preserving saved answers', () => {
  const setup = complete();
  const legacy = structuredClone(setup);
  legacy.answers.company.followUp = true;
  assert.deepEqual(restoreSetup(legacy), setup);
});

test('old or malformed storage migrates safely without losing valid answers', () => {
  assert.deepEqual(restoreSetup(undefined), { answers: {}, completed: false });
  assert.deepEqual(restoreSetup({ answers: { audience: { selected: null } }, completed: true }), { answers: {}, completed: false });
  assert.deepEqual(restoreSetup(complete()), complete());
});
