import {
  createStructuredEditReviewPlan,
  resolveStructuredEditReviewApply,
  structuredEditTransactionFromJsonEdit,
  type JsonVisualEditIntent,
  type JsonVisualEditPlan,
  type StructuredEditSourcePreview,
  type StructuredEditTransaction,
  type StructuredReviewPlan,
} from '@sciemd/core';

export interface JsonEditReviewState {
  intent: JsonVisualEditIntent;
  preview: StructuredEditSourcePreview;
  reviewPlan: StructuredReviewPlan;
  transaction: StructuredEditTransaction;
  plan: JsonVisualEditPlan & { ok: true; nextSource: string };
  sourceHash: string;
  documentEpoch: number;
  schemaGeneratedValueExplanation?: string;
}

export function jsonVisualEditNeedsReview(intent: JsonVisualEditIntent): boolean {
  return intent.kind !== 'replaceScalar';
}

export function createJsonEditReviewState({
  source,
  intent,
  plan,
  documentEpoch,
}: {
  source: string;
  intent: JsonVisualEditIntent;
  plan: JsonVisualEditPlan;
  documentEpoch: number;
}): JsonEditReviewState | null {
  if (!plan.ok || plan.nextSource === undefined) return null;
  const transaction = structuredEditTransactionFromJsonEdit(source, intent, plan);
  if (!transaction) return null;
  const schemaGeneratedValueExplanation = schemaGeneratedValueExplanationForIntent(intent);
  const reviewPlan = createStructuredEditReviewPlan({
    source,
    transaction,
    documentEpoch,
    notes: schemaGeneratedValueExplanation ? [schemaGeneratedValueExplanation] : [],
  });
  if (!reviewPlan) return null;
  return {
    intent,
    preview: reviewPlan.sourcePreview,
    reviewPlan,
    transaction,
    plan: plan as JsonVisualEditPlan & { ok: true; nextSource: string },
    sourceHash: reviewPlan.sourceHash,
    documentEpoch,
    schemaGeneratedValueExplanation,
  };
}

export function resolveJsonEditReviewApply(
  currentSource: string,
  currentDocumentEpoch: number,
  review: JsonEditReviewState,
): { ok: true; nextSource: string; previewLabel: string; transaction: StructuredEditTransaction } | { ok: false; reason: string } {
  return resolveStructuredEditReviewApply(currentSource, currentDocumentEpoch, review.reviewPlan);
}

function schemaGeneratedValueExplanationForIntent(intent: JsonVisualEditIntent): string | undefined {
  return intent.kind === 'addObjectField' || intent.kind === 'addArrayItem'
    ? intent.schemaGeneratedValueExplanation
    : undefined;
}
