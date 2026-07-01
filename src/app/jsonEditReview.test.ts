import { describe, expect, it } from 'vitest';
import { planJsonVisualEdit, type JsonVisualEditIntent } from '@sciemd/core';
import {
  createJsonEditReviewState,
  jsonVisualEditNeedsReview,
  resolveJsonEditReviewApply,
} from './jsonEditReview';

describe('jsonEditReview', () => {
  it('requires review for structural JSON edits but not scalar replacement', () => {
    expect(jsonVisualEditNeedsReview({
      kind: 'replaceScalar',
      path: ['name'],
      nextValue: 'B',
    })).toBe(false);
    expect(jsonVisualEditNeedsReview({
      kind: 'addObjectField',
      path: ['meta'],
      key: 'status',
      value: 'draft',
    })).toBe(true);
    expect(jsonVisualEditNeedsReview({
      kind: 'deleteArrayItem',
      path: ['items', 0],
    })).toBe(true);
  });

  it('creates review state for a planned structural edit and resolves apply while source is unchanged', () => {
    const source = '{\n  "meta": {}\n}\n';
    const intent: JsonVisualEditIntent = {
      kind: 'addObjectField',
      path: ['meta'],
      key: 'status',
      value: 'draft',
      schemaGeneratedValueExplanation: 'Uses the explicit schema default for $.meta.status.',
    };
    const plan = planJsonVisualEdit(source, intent);

    const review = createJsonEditReviewState({
      source,
      intent,
      plan,
      documentEpoch: 7,
    });

    expect(review?.preview.previewLabel).toBe('Added $.meta.status.');
    expect(review?.schemaGeneratedValueExplanation).toBe('Uses the explicit schema default for $.meta.status.');
    const result = review ? resolveJsonEditReviewApply(source, 7, review) : null;
    expect(result).toMatchObject({
      ok: true,
      nextSource: '{\n  "meta": {\n    "status": "draft"\n  }\n}\n',
    });
  });

  it('rejects stale reviewed edits after source or document epoch changes', () => {
    const source = '{"items":[1]}';
    const intent: JsonVisualEditIntent = {
      kind: 'addArrayItem',
      path: ['items'],
      index: 1,
      value: 2,
    };
    const plan = planJsonVisualEdit(source, intent);
    const review = createJsonEditReviewState({
      source,
      intent,
      plan,
      documentEpoch: 2,
    });

    expect(review).not.toBeNull();
    expect(review && resolveJsonEditReviewApply('{"items":[1,3]}', 2, review)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('JSON source changed'),
    });
    expect(review && resolveJsonEditReviewApply(source, 3, review)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('JSON source changed'),
    });
  });
});
