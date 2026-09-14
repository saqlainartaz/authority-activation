import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = await readFile(new URL('../src/refined/conversation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { buildConversationMessages } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const ws = (overrides = {}) => ({ phase: 'streaming', thread: [{ who: 'u', text: 'Write my post' }], visible: { done: [{ segs: [{ t: 'Complete paragraph.' }] }], partial: 'Still writing' }, fmt: 'li', title: 'My post', xPosts: [{ t: 'My X post' }], ...overrides });
const texts = messages => messages.map(m => m.content[0].text);

test('compact conversation streams the actual partial draft after the request', () => {
  const messages = buildConversationMessages(ws(), true);
  assert.deepEqual(messages.map(m => m.id), ['0', 'current-draft']);
  assert.match(texts(messages)[1], /Complete paragraph\.\n\nStill writing$/);
});
test('the final reply follows the completed draft', () => {
  const messages = buildConversationMessages(ws({ phase: 'record', thread: [{ who: 'u', text: 'Write my post' }, { who: 't', n: 2 }, { who: 'a', text: 'Ready', text2: '', strong: '' }] }), true);
  assert.deepEqual(messages.map(m => m.id), ['0', 'current-draft', '1']);
  assert.equal(texts(messages)[2].trim(), 'Ready');
});
test('rewriting preserves earlier conversation and displays one current draft', () => {
  const messages = buildConversationMessages(ws({ thread: [{ who: 'u', text: 'First request' }, { who: 'a', text: 'First reply', text2: '', strong: '' }, { who: 'u', text: 'Shorter' }] }), true);
  assert.deepEqual(messages.map(m => m.id), ['0', '1', '2', 'current-draft']);
  assert.equal(texts(messages)[0], 'First request');
  assert.equal(texts(messages)[2], 'Shorter');
});
test('desktop keeps the draft in its existing separate canvas', () => {
  assert.equal(buildConversationMessages(ws(), false).some(m => m.id === 'current-draft'), false);
});
test('opening a saved record without a transcript still exposes its draft', () => {
  const messages = buildConversationMessages(ws({ phase: 'record', thread: [] }), true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, 'current-draft');
});
test('unsourced text stays marked and the selected X format is respected', () => {
  const unsourced = ws({ visible: { done: [{ miss: true, segs: [{ t: 'Unverified claim' }] }] } });
  assert.match(texts(buildConversationMessages(unsourced, true))[1], /\[Needs a source\]/);
  const x = buildConversationMessages(ws({ phase: 'record', fmt: 'x', visible: { done: [] } }), true);
  assert.match(texts(x)[1], /My post · X\n\nMy X post$/);
});
