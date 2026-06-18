export const SUPPORTED_MARKDOWN_FEATURES = [
  'headings',
  'paragraphs',
  'bold',
  'italic',
  'inlineCode',
  'links',
  'images',
  'blockquotes',
  'bulletLists',
  'orderedLists',
  'codeBlocks',
  'horizontalRules',
  'gfmTables',
  'gfmFootnotes',
  'taskLists',
  'katexMath',
  'mermaidFences',
  'knownDirectiveBlocks',
] as const;

export const SOURCE_ONLY_MARKDOWN_FEATURES = [
  'unknownOrUnclosedDirectiveBlocks',
  'largeDocumentsOverFiveMb',
] as const;

export const LARGE_FILE_WARNING_BYTES = 1 * 1024 * 1024;
export const SOURCE_ONLY_FILE_BYTES = 5 * 1024 * 1024;

export const MARKDOWN_FILE_EXTENSIONS = ['md', 'markdown'];

export function isMarkdownPath(filePath: string): boolean {
  const extension = filePath.replace(/\\/g, '/').split('/').at(-1)?.split('.').at(-1)?.toLowerCase() ?? '';
  return MARKDOWN_FILE_EXTENSIONS.includes(extension);
}
