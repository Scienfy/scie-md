import { normalizeMarkdownInput } from '../app/documentState';

export function normalizeEditorMarkdown(markdown: string): string {
  return normalizeMarkdownInput(markdown);
}
