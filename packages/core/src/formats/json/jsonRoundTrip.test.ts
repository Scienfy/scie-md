import { describe, expect, it } from 'vitest';
import { createJsonContent, parseJsonDocument } from './parseJsonDocument';
import {
  addJsonObjectField,
  applyJsonEdits,
  insertJsonArrayItem,
  jsonFormattingPolicyForSource,
  removeJsonArrayItem,
  renameJsonObjectKey,
  replaceJsonScalarAtPath,
} from './jsonEdits';

describe('JSON source preservation groundwork', () => {
  it.each([
    ['LF JSON', '{\n  "name": "A",\n  "values": [1, 2, 3]\n}\n'],
    ['CRLF JSON', '{\r\n  "name": "A",\r\n  "values": [1, 2, 3]\r\n}\r\n'],
    ['mixed line endings documented as source text', '{\r\n  "a": 1,\n  "b": 2\r\n}\n'],
    ['indentation variants', '{\n\t"name": "A",\n\t"nested": {\n\t\t"ok": true\n\t}\n}\n'],
    ['key order', '{"z":0,"a":1,"m":2}\n'],
    ['escaped strings', '{"quote":"\\"","slash":"\\\\","unicode":"\\u03b1"}\n'],
    ['unicode escapes', '{"mu":"\\u03bc","emoji":"\\ud83e\\uddea"}\n'],
    ['duplicate keys', '{"sample":1,"sample":2}\n'],
    ['large integers and exponent numbers', '{"unsafe":900719925474099312345,"exp":1.2e+45}\n'],
    ['nested arrays and objects', '{"a":[{"b":[true,false,null]}]}\n'],
    ['top-level array', '[1,{"a":2},3]\n'],
    ['top-level scalar', '"plain scalar"\n'],
  ])('parses %s without changing source text on no-op visual inspection', (_name, source) => {
    const result = parseJsonDocument(createJsonContent(source, 'C:\\Lab\\sample.json'));

    expect(result.content.text).toBe(source);
    expect(source).toBe(source);
  });

  it('documents that mixed line endings are preserved only as in-memory source text before raw byte preservation', () => {
    const mixed = '{\r\n  "a": 1,\n  "b": 2\r\n}\n';
    const result = parseJsonDocument(createJsonContent(mixed, null));

    expect(result.content.text).toBe(mixed);
    expect(jsonFormattingPolicyForSource(mixed).eol).toBe('\r\n');
  });

  it('replaces a scalar by editing only the scalar source range', () => {
    const source = '{\n  "sample": {\n    "name": "A",\n    "n": 12,\n    "ok": true\n  }\n}\n';
    const plan = replaceJsonScalarAtPath(source, ['sample', 'name'], 'B');

    expect(plan.unsupportedReason).toBeUndefined();
    expect(plan.edits).toHaveLength(1);
    expect(source.slice(plan.edits[0].offset, plan.edits[0].offset + plan.edits[0].length)).toBe('"A"');
    expect(applyJsonEdits(source, plan.edits)).toBe('{\n  "sample": {\n    "name": "B",\n    "n": 12,\n    "ok": true\n  }\n}\n');
  });

  it('renames a simple key without moving the property value or sibling keys', () => {
    const source = '{\n  "sample": {\n    "old": 12,\n    "next": 13\n  }\n}\n';
    const plan = renameJsonObjectKey(source, ['sample'], 'old', 'renamed');

    expect(plan.unsupportedReason).toBeUndefined();
    expect(plan.edits).toHaveLength(1);
    expect(source.slice(plan.edits[0].offset, plan.edits[0].offset + plan.edits[0].length)).toBe('"old"');
    expect(applyJsonEdits(source, plan.edits)).toBe('{\n  "sample": {\n    "renamed": 12,\n    "next": 13\n  }\n}\n');
  });

  it('adds a simple object field while preserving existing ranges', () => {
    const source = '{\n  "sample": {\n    "name": "A"\n  }\n}\n';
    const plan = addJsonObjectField(source, ['sample'], 'count', 2);
    const next = applyJsonEdits(source, plan.edits);

    expect(plan.unsupportedReason).toBeUndefined();
    expect(next).toContain('"name": "A"');
    expect(next).toContain('"count": 2');
    expect(next.startsWith('{\n  "sample"')).toBe(true);
  });

  it('inserts and removes simple array items with localized text edits', () => {
    const source = '{\n  "values": [\n    1,\n    3\n  ]\n}\n';
    const insert = insertJsonArrayItem(source, ['values'], 1, 2);
    const inserted = applyJsonEdits(source, insert.edits);
    const remove = removeJsonArrayItem(inserted, ['values'], 2);

    expect(insert.unsupportedReason).toBeUndefined();
    expect(remove.unsupportedReason).toBeUndefined();
    expect(inserted).toContain('1,\n    2,\n    3');
    expect(applyJsonEdits(inserted, remove.edits)).toContain('1,\n    2');
  });

  it('keeps unsupported or unsafe structures read-only', () => {
    expect(replaceJsonScalarAtPath('{"array":[1]}', ['array'], 2).unsupportedReason)
      .toMatch(/Only scalar/);
    expect(renameJsonObjectKey('{"a":1,"a":2}', [], 'a', 'b').unsupportedReason)
      .toMatch(/missing or duplicated/);
    expect(addJsonObjectField('{"a":1}', [], 'b', Number.NaN).unsupportedReason)
      .toMatch(/finite JSON-compatible/);
    expect(insertJsonArrayItem('{"values":[1]}', ['values'], 10, 2).unsupportedReason)
      .toMatch(/outside/);
  });

  it('preserves unsafe number spelling unless an explicit scalar replacement is requested', () => {
    const source = '{"unsafe":900719925474099312345,"safe":1}\n';
    const parsed = parseJsonDocument(createJsonContent(source, null));
    const plan = replaceJsonScalarAtPath(source, ['safe'], 2);

    expect(parsed.content.text).toBe(source);
    expect(applyJsonEdits(source, plan.edits)).toBe('{"unsafe":900719925474099312345,"safe":2}\n');
  });
});
