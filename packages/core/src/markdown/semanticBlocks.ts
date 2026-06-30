export type SemanticBlockType = 'figure' | 'note' | 'callout' | 'tip' | 'important' | 'warning' | 'result';

const DEFAULT_BLOCK_BODY: Record<Exclude<SemanticBlockType, 'figure'>, string> = {
  note: 'Supporting note.',
  callout: 'Key takeaway.',
  tip: 'Helpful suggestion.',
  important: 'Important point.',
  warning: 'Important limitation or risk.',
  result: 'Summarize the result and its interpretation.',
};

interface SemanticBlockOptions {
  body?: string;
  figureLabel?: string;
}

export function createSemanticBlockMarkdown(type: SemanticBlockType, options: SemanticBlockOptions = {}): string {
  const body = options.body?.trim();

  if (type === 'figure') {
    const label = options.figureLabel?.trim();
    const attrs = label ? ` {#${label}}` : '';
    const figureBody = body || '![Figure alt text](assets/figure.png)\n\nFigure caption.';
    return `:::figure${attrs}\n${figureBody}\n:::\n\n`;
  }

  return `:::${type}\n${body || DEFAULT_BLOCK_BODY[type]}\n:::\n\n`;
}
