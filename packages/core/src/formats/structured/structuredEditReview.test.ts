import { describe, expect, it } from 'vitest';
import { planJsonVisualEdit } from '../json/jsonEdits';
import { planJsonlVisualEdit } from '../jsonl/jsonlEdits';
import { planTabularVisualEdit } from '../tabular/tabularEdits';
import {
  createStructuredClipboardReplaceReviewPlan,
  createStructuredEditReviewPlan,
  resolveStructuredEditReviewApply,
  structuredEditTransactionFromJsonEdit,
  structuredEditTransactionFromJsonlEdit,
  structuredEditTransactionFromTabularEdit,
} from './structuredEditReview';

describe('structuredEditReview', () => {
  it('wraps JSON edit plans with path target metadata and review previews', () => {
    const source = '{\n  "meta": {}\n}\n';
    const intent = {
      kind: 'addObjectField' as const,
      path: ['meta'],
      key: 'status',
      value: 'draft',
    };
    const plan = planJsonVisualEdit(source, intent);
    const transaction = structuredEditTransactionFromJsonEdit(source, intent, plan);
    const review = transaction ? createStructuredEditReviewPlan({ source, transaction, documentEpoch: 4 }) : null;

    expect(transaction).toMatchObject({
      format: 'json',
      operationId: 'addObjectField',
      operationLabel: 'Add JSON field',
      target: {
        kind: 'path',
        label: '$.meta',
        pointer: '/meta',
      },
      requiresReview: true,
      postApplyValidation: 'schema',
    });
    expect(review).toMatchObject({
      title: 'Review JSON Source Change',
      actionLabel: 'Apply JSON change',
      summary: 'Added $.meta.status.',
      documentEpoch: 4,
      sourcePreview: {
        previewLabel: 'Added $.meta.status.',
        riskLabel: 'Replace source range',
      },
    });
    expect(review && resolveStructuredEditReviewApply(source, 4, review)).toMatchObject({
      ok: true,
      nextSource: '{\n  "meta": {\n    "status": "draft"\n  }\n}\n',
    });
  });

  it('rejects reviewed edits when the source hash or epoch changes', () => {
    const source = '{"items":[1]}';
    const intent = {
      kind: 'addArrayItem' as const,
      path: ['items'],
      index: 1,
      value: 2,
    };
    const plan = planJsonVisualEdit(source, intent);
    const transaction = structuredEditTransactionFromJsonEdit(source, intent, plan);
    const review = transaction ? createStructuredEditReviewPlan({ source, transaction, documentEpoch: 2 }) : null;

    expect(review).not.toBeNull();
    expect(review && resolveStructuredEditReviewApply('{"items":[1,3]}', 2, review)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('JSON source changed'),
    });
    expect(review && resolveStructuredEditReviewApply(source, 3, review)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('JSON source changed'),
    });
  });

  it('wraps JSONL record edit plans with line-level targets', () => {
    const source = '{"id":1}\n{"id":2}\n';
    const intent = {
      kind: 'deleteRecord' as const,
      lineNumber: 2,
    };
    const plan = planJsonlVisualEdit(source, intent);
    const transaction = structuredEditTransactionFromJsonlEdit(source, intent, plan);

    expect(transaction).toMatchObject({
      format: 'jsonl',
      operationId: 'deleteRecord',
      operationLabel: 'Delete JSONL record',
      target: {
        kind: 'record',
        label: 'JSONL line 2',
        lineNumber: 2,
      },
      destructive: true,
      requiresReview: true,
      riskLabel: 'Delete source range',
    });
  });

  it('wraps tabular edit plans with cell targets', () => {
    const source = 'id,count\nS-001,1\n';
    const intent = {
      kind: 'replaceCell' as const,
      format: 'csv' as const,
      dataRowIndex: 0,
      columnIndex: 1,
      nextValue: '2',
    };
    const plan = planTabularVisualEdit(source, intent);
    const transaction = structuredEditTransactionFromTabularEdit(source, intent, plan);

    expect(transaction).toMatchObject({
      format: 'csv',
      operationId: 'replaceCell',
      operationLabel: 'Edit CSV cell',
      target: {
        kind: 'cell',
        label: 'CSV row 1, column 2',
        rowIndex: 0,
        columnIndex: 1,
      },
      destructive: false,
      requiresReview: false,
      riskLabel: 'Replace source range',
    });
  });

  it('wraps JSON clipboard replacement as a document-level review transaction', () => {
    const source = '{"id":1}\n';
    const replacement = '{"id":2}\n';
    const review = createStructuredClipboardReplaceReviewPlan({
      format: 'json',
      source,
      replacement,
      documentEpoch: 7,
    });

    expect(review).toMatchObject({
      title: 'Review JSON Source Change',
      actionLabel: 'Apply JSON change',
      summary: 'Replace JSON document from clipboard.',
      transaction: {
        operationId: 'applyClipboardReplace',
        operationLabel: 'Apply JSON clipboard replacement',
        target: {
          kind: 'document',
          label: 'JSON document',
        },
        destructive: true,
        requiresReview: true,
        postApplyValidation: 'schema',
      },
    });
    expect(review && resolveStructuredEditReviewApply(source, 7, review)).toMatchObject({
      ok: true,
      nextSource: replacement,
    });
  });
});
