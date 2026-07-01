import { describe, expect, it } from 'vitest';
import {
  applyJsonStructuralReviewDecisions,
  createJsonStructuralReview,
} from './jsonStructuralDiff';

describe('jsonStructuralDiff', () => {
  it('creates path-level entries for object, scalar, and array changes', () => {
    const review = createJsonStructuralReview(
      '{\n  "name": "A",\n  "meta": {\n    "count": 1,\n    "remove": true\n  },\n  "items": [\n    "a",\n    "b"\n  ]\n}\n',
      '{\n  "name": "local",\n  "meta": {\n    "count": 1,\n    "remove": true\n  },\n  "items": [\n    "a",\n    "b"\n  ]\n}\n',
      '{\n  "name": "B",\n  "meta": {\n    "count": 2,\n    "added": false\n  },\n  "items": [\n    "a",\n    "c",\n    "d"\n  ]\n}\n',
    );

    expect(review.status).toBe('ready');
    expect(review.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'changed',
        displayPath: '$.name',
        basePreview: '"A"',
        currentPreview: '"local"',
        diskPreview: '"B"',
        conflict: true,
      }),
      expect.objectContaining({
        kind: 'changed',
        displayPath: '$.meta.count',
        currentSpan: expect.objectContaining({ line: 4 }),
        diskSpan: expect.objectContaining({ line: 4 }),
      }),
      expect.objectContaining({
        kind: 'added',
        displayPath: '$.meta.added',
        diskPreview: 'false',
      }),
      expect.objectContaining({
        kind: 'removed',
        displayPath: '$.meta.remove',
        diskType: 'missing',
      }),
      expect.objectContaining({
        kind: 'changed',
        displayPath: '$.items[1]',
        warnings: [expect.stringContaining('numeric index')],
      }),
      expect.objectContaining({
        kind: 'added',
        displayPath: '$.items[2]',
      }),
    ]));
  });

  it('applies accepted disk paths onto current JSON without conflict markers', () => {
    const review = createJsonStructuralReview(
      '{\n  "name": "A",\n  "meta": {\n    "count": 1,\n    "remove": true\n  },\n  "items": [\n    "a",\n    "b"\n  ]\n}\n',
      '{\n  "name": "local",\n  "meta": {\n    "count": 1,\n    "remove": true\n  },\n  "items": [\n    "a",\n    "b"\n  ]\n}\n',
      '{\n  "name": "B",\n  "meta": {\n    "count": 2,\n    "added": false\n  },\n  "items": [\n    "a",\n    "c",\n    "d"\n  ]\n}\n',
    );
    const rejected = new Set(
      review.entries
        .filter((entry) => entry.displayPath === '$.name')
        .map((entry) => entry.id),
    );

    const result = applyJsonStructuralReviewDecisions(review, rejected);

    expect(result.ok).toBe(true);
    expect(result.nextSource).not.toContain('<<<<<<<');
    expect(JSON.parse(result.nextSource ?? '')).toEqual({
      name: 'local',
      meta: {
        count: 2,
        added: false,
      },
      items: ['a', 'c', 'd'],
    });
  });

  it('applies accepted disk paths with raw disk number tokens', () => {
    const review = createJsonStructuralReview(
      '{"id":1,"meta":{"threshold":1}}',
      '{"id":2,"meta":{"threshold":2,"local":true}}',
      '{"id":900719925474099312345,"meta":{"threshold":1.2300e+12}}',
    );

    const result = applyJsonStructuralReviewDecisions(review, new Set());

    expect(result.ok).toBe(true);
    expect(result.nextSource).toContain('900719925474099312345');
    expect(result.nextSource).toContain('1.2300e+12');
  });

  it('accepts root-level disk changes as raw disk source instead of reserializing', () => {
    const diskSource = '900719925474099312345\n';
    const review = createJsonStructuralReview('1\n', '2\n', diskSource);

    const result = applyJsonStructuralReviewDecisions(review, new Set());

    expect(result.ok).toBe(true);
    expect(result.nextSource).toBe(diskSource);
  });

  it('falls back when any side is invalid or has duplicate keys', () => {
    const invalid = createJsonStructuralReview('{"a":1}', '{"a":1}', '{"a":}');
    expect(invalid).toMatchObject({
      status: 'fallback',
      fallbackReason: 'Both current and disk JSON must parse before structural review is available.',
    });
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({
      code: expect.stringContaining('json-review-disk-json-syntax'),
    }));

    const duplicate = createJsonStructuralReview('{"a":1}', '{"a":1}', '{"a":1,"a":2}');
    expect(duplicate).toMatchObject({
      status: 'fallback',
      fallbackReason: 'Resolve duplicate JSON object keys before using path-level structural review.',
    });
    expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({
      code: 'json-duplicate-key',
    }));
  });
});
