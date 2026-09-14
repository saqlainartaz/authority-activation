import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = await readFile(new URL('../src/refined/documents.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { fileIssue, fileKey, MAX_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
test('document intake accepts supported files with case-insensitive extensions', () => {
  for (const name of ['Research.PDF', 'Company.docx', 'notes.md', 'sales.csv', 'deck.pptx']) assert.equal(fileIssue({ name, size: 1234 }), null);
});
test('document intake rejects unsupported, empty and oversized files without rejecting the limit', () => {
  assert.ok(fileIssue({ name: 'program.exe', size: 1234 }));
  assert.ok(fileIssue({ name: 'invoice.pdf.exe', size: 1234 }));
  assert.ok(fileIssue({ name: 'empty.pdf', size: 0 }));
  assert.ok(fileIssue({ name: 'large.pdf', size: MAX_BYTES + 1 }));
  assert.equal(fileIssue({ name: 'limit.pdf', size: MAX_BYTES }), null);
});
test('duplicate identity preserves updated files and filenames with separators', () => {
  const file = { name: 'Company notes.pdf', size: 1200, lastModified: 123 };
  assert.equal(fileKey(file), fileKey({ ...file }));
  assert.notEqual(fileKey(file), fileKey({ ...file, lastModified: 124 }));
  assert.notEqual(fileKey(file), fileKey({ ...file, size: 1201 }));
  assert.notEqual(fileKey(file), fileKey({ ...file, name: 'Other.pdf' }));
});
