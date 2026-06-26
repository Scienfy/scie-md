export type DocumentOpenPhase = 'reading' | 'preparing' | 'restoring';

export interface DocumentOpenStatus {
  fileName: string;
  message: string;
  detail: string;
}

export function createDocumentOpenStatus(path: string, phase: DocumentOpenPhase): DocumentOpenStatus {
  const fileName = displayNameForPath(path);
  if (phase === 'restoring') {
    return {
      fileName,
      message: 'Restoring recovery draft',
      detail: 'Applying the recovered edits before the document is shown.',
    };
  }
  if (phase === 'preparing') {
    return {
      fileName,
      message: 'Preparing document view',
      detail: 'Rendering the editor. Large documents can take a few seconds.',
    };
  }
  return {
    fileName,
    message: 'Opening document',
    detail: 'Reading the Markdown file and preparing the editor.',
  };
}

function displayNameForPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return 'Selected document';
  const parts = trimmed.split(/[\\/]+/);
  return parts[parts.length - 1] || trimmed;
}
