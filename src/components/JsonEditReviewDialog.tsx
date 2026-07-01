import type { StructuredEditSourcePreview, StructuredReviewPlan } from '@sciemd/core';
import { StructuredEditReviewDialog } from './StructuredEditReviewDialog';

interface JsonEditReviewDialogProps {
  open: boolean;
  preview: StructuredEditSourcePreview | null;
  reviewPlan?: StructuredReviewPlan | null;
  schemaGeneratedValueExplanation?: string;
  onApply: () => void;
  onCancel: () => void;
}

export function JsonEditReviewDialog({
  open,
  preview,
  reviewPlan = null,
  schemaGeneratedValueExplanation,
  onApply,
  onCancel,
}: JsonEditReviewDialogProps) {
  return (
    <StructuredEditReviewDialog
      open={open}
      reviewPlan={reviewPlan}
      preview={preview}
      title="Review JSON Source Change"
      actionLabel="Apply JSON change"
      closeLabel="Close JSON source review"
      schemaGeneratedValueExplanation={schemaGeneratedValueExplanation}
      onApply={onApply}
      onCancel={onCancel}
    />
  );
}
