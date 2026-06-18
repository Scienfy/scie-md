import { describe, expect, it } from 'vitest';
import { insertLockMarkdown, insertScientificBlockMarkdown, insertVersionMarkdown } from '../src/webview/editorOperations';
import type { SourceSelection } from '../src/webview/editorOperations';

function selectText(markdown: string, text: string): SourceSelection {
  const from = markdown.indexOf(text);
  if (from < 0) throw new Error(`Selection text not found: ${text}`);
  return {
    text,
    from,
    to: from + text.length,
    line: markdown.slice(0, from).split('\n').length,
    endLine: markdown.slice(0, from + text.length).split('\n').length,
    surface: 'source',
  };
}

describe('webview editor operations', () => {
  it('uses a quote lock for mid-paragraph selections instead of splicing block markers into prose', () => {
    const markdown = 'The approved phrase stays in this paragraph.\n';
    const output = insertLockMarkdown(markdown, selectText(markdown, 'approved phrase'));

    expect(output).toContain('<!-- scie_md:lock ');
    expect(output).toContain('target="quote"');
    expect(output).toContain('quote="approved phrase"');
    expect(output).toContain(markdown);
    expect(output).not.toContain('approved <!-- scie_md:lock:end -->');
  });

  it('wraps whole-line lock selections as protected blocks', () => {
    const markdown = 'Intro.\n\nApproved paragraph.\n\nNext.\n';
    const output = insertLockMarkdown(markdown, {
      text: 'Approved paragraph.\n',
      from: markdown.indexOf('Approved paragraph.'),
      to: markdown.indexOf('Approved paragraph.') + 'Approved paragraph.\n'.length,
      line: 3,
      endLine: 3,
      surface: 'source',
    });

    expect(output).toContain('<!-- scie_md:lock:start reason="human-approved" -->');
    expect(output).toContain('Approved paragraph.');
    expect(output).toContain('<!-- scie_md:lock:end -->');
  });

  it('inserts anchored text versions near mid-paragraph selections', () => {
    const markdown = 'This claim needs an alternative version.\n';
    const output = insertVersionMarkdown(markdown, selectText(markdown, 'claim'), 'claim-framing');

    expect(output).toContain('scie_md:variant:group');
    expect(output).toContain('target="quote"');
    expect(output).toContain('quote="claim"');
    expect(output).toContain(markdown);
  });

  it('places scientific blocks beside partial selections instead of inside the sentence', () => {
    const markdown = 'The result sentence continues here.\n';
    const output = insertScientificBlockMarkdown(markdown, selectText(markdown, 'result sentence'), 'result');

    expect(output).toContain(':::result');
    expect(output).toContain('result sentence');
    expect(output).toContain(markdown);
    expect(output).not.toContain('The :::result');
  });
});
