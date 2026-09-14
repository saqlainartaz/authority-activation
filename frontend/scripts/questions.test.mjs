import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = await readFile(new URL('../src/refined/questions.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { QUESTIONS, OTHER_ANSWER, getQuestionAnswer: answer } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const single = QUESTIONS.find(q => q.kind === 'single');
const multiple = QUESTIONS.find(q => q.kind === 'multiple');

test('choice questions require a selection and custom choices require meaningful text', () => {
  for (const q of [single, multiple]) {
    assert.equal(answer(q, [], 'Unselected custom text'), null);
    assert.equal(answer(q, [OTHER_ANSWER], ' \n '), null);
    assert.deepEqual(answer(q, [OTHER_ANSWER], '  Ask me each time.  '), ['Ask me each time.']);
  }
});
test('multiple answers preserve both selected options and the actual custom response', () => {
  const picks = [multiple.options[0], multiple.options[2], OTHER_ANSWER];
  assert.equal(answer(multiple, picks, ''), null);
  assert.deepEqual(answer(multiple, picks, 'What support is included?'), [...picks.slice(0, 2), 'What support is included?']);
});
test('changing away from Something else does not save hidden text', () => {
  for (const q of [single, multiple]) {
    assert.deepEqual(answer(q, [q.options[0]], 'Old custom answer'), [q.options[0]]);
  }
});
test('short and long answers reject blank responses and preserve written paragraphs', () => {
  for (const kind of ['short', 'long']) {
    const q = QUESTIONS.find(q => q.kind === kind);
    assert.ok(q);
    assert.equal(answer(q, [], ' \n '), null);
    const content = kind === 'long' ? 'We started by listening.\n\nThen we changed the process.' : 'Members';
    assert.deepEqual(answer(q, [], `  ${content}  `), [content]);
  }
});
