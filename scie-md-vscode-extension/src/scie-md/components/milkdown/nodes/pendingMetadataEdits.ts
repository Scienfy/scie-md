export interface PendingMetadataEditNodeView {
  flushPendingEditForSync(): boolean;
}

const activePendingEditNodeViews = new Set<PendingMetadataEditNodeView>();

export function registerPendingMetadataEditNodeView(nodeView: PendingMetadataEditNodeView): () => void {
  activePendingEditNodeViews.add(nodeView);
  return () => {
    activePendingEditNodeViews.delete(nodeView);
  };
}

export function flushPendingMetadataNodeViewEdits(): boolean {
  let changed = false;
  for (const nodeView of Array.from(activePendingEditNodeViews)) {
    changed = nodeView.flushPendingEditForSync() || changed;
  }
  return changed;
}
