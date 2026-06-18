import { createVariableToken, upsertFrontmatterVariable, VARIABLE_NAME_PATTERN } from '../shared/domain/variables/variableEditing';
import { createProtectedAnchorSnippet, createProtectedBlockSnippet } from '../shared/markdown/protectedBlocks';
import { createSemanticBlockMarkdown } from '../shared/markdown/semanticBlocks';
import type { SemanticBlockType } from '../shared/markdown/semanticBlocks';
import { insertStandaloneMarkdownBlockNearSelection, wrapMarkdownBlockSelection } from '../shared/markdown/selectionWrapping';
import type { MarkdownSelectionSnapshot } from '../shared/markdown/selectionWrapping';
import { createTargetedInstructionSnippet } from '../shared/markdown/targetedInstructions';
import { createAnchoredVariantGroupSnippet, createVariantGroupSnippet } from '../shared/markdown/variants';

export interface SourceSelection extends MarkdownSelectionSnapshot {
  from: number;
  to: number;
  surface: 'source';
}

export function insertMarkdownSnippet(markdown: string, selection: SourceSelection, snippet: string): string {
  return `${markdown.slice(0, selection.from)}${snippet}${markdown.slice(selection.to)}`;
}

export function insertLockMarkdown(markdown: string, selection: SourceSelection): string {
  const selectedText = selection.text.trim();
  if (!selectedText) {
    return insertStandaloneMarkdownBlockNearSelection(
      markdown,
      selection,
      createProtectedBlockSnippet('Protected content.', 'human-approved'),
      selection.line,
    );
  }

  const wrapped = wrapMarkdownBlockSelection(
    markdown,
    selection,
    (rawSelection) => createProtectedBlockSnippet(rawSelection.trimEnd(), 'human-approved'),
    selection.line,
  );
  if (wrapped) return wrapped;

  return insertStandaloneMarkdownBlockNearSelection(
    markdown,
    selection,
    `${createProtectedAnchorSnippet(selectedText, 'human-approved', undefined, {
      markdown,
      preferredLine: selection.line,
      selectionLine: selection.line,
    })}\n\n`,
    selection.line,
  );
}

export function insertInstructionMarkdown(markdown: string, selection: SourceSelection): string {
  return insertStandaloneMarkdownBlockNearSelection(
    markdown,
    selection,
    createTargetedInstructionSnippet(),
    selection.line,
  );
}

export function insertScientificBlockMarkdown(
  markdown: string,
  selection: SourceSelection,
  type: SemanticBlockType,
): string {
  const snippet = createSemanticBlockMarkdown(type, { body: selection.text });
  const wrapped = selection.text.trim()
    ? wrapMarkdownBlockSelection(markdown, selection, () => snippet, selection.line)
    : null;
  if (wrapped) return wrapped;

  return insertStandaloneMarkdownBlockNearSelection(markdown, selection, snippet, selection.line);
}

export function insertVersionMarkdown(markdown: string, selection: SourceSelection, groupId: string): string {
  const id = sanitizeVariantGroupId(groupId.trim() || 'revision-choice');
  const selectedText = selection.text.trim();
  const snippet = selectedText
    ? `${createAnchoredVariantGroupSnippet(id, selectedText, 'v1', {
        markdown,
        preferredLine: selection.line,
        selectionLine: selection.line,
      })}\n`
    : createVariantGroupSnippet(id, 'v1');

  return insertStandaloneMarkdownBlockNearSelection(markdown, selection, snippet, selection.line);
}

export function insertVariableMarkdown(markdown: string, selection: SourceSelection, name: string, value: string): string {
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw new Error('Variable names must start with a letter or underscore and use only letters, numbers, dots, dashes, and underscores.');
  }
  const withToken = insertMarkdownSnippet(markdown, selection, createVariableToken(name));
  return upsertFrontmatterVariable(withToken, name, value);
}

function sanitizeVariantGroupId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'revision-choice';
}
