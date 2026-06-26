import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedScienfyDocument } from '../domain/document/documentModel';
import type { EditorComment } from '../markdown/editorComments';
import type { ProtectedBlock } from '../markdown/protectedBlocks';
import { MetadataRail } from './MetadataRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('MetadataRail', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('shows marker-specific icon tooltips without rendering an aggregate feature card', () => {
    const onJumpToLine = vi.fn();

    act(() => {
      renderRail(onJumpToLine, {
        editorComments: [
          {
            line: 12,
            audience: 'llm',
            body: 'Revise this exact sentence only.',
            id: 'llm-1',
          },
          {
            line: 18,
            audience: 'human',
            body: 'Reviewed the revision for clarity.',
            id: 'human-1',
            sourceNoteId: 'llm-1',
          },
        ],
      });
    });

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.metadata-rail-item'));
    expect(buttons).toHaveLength(2);
    expect(container.querySelector('.metadata-rail-card')).toBeNull();
    expect(buttons[0].hasAttribute('title')).toBe(false);
    expect(buttons[0].querySelector('span')).toBeNull();
    expect(buttons[0].getAttribute('data-tooltip')).toBe('Note to LLM: Revise this exact sentence only. (line 12)');
    expect(buttons[0].getAttribute('data-tooltip-title')).toBe('Note to LLM');
    expect(buttons[0].getAttribute('data-tooltip-detail')).toBe('Revise this exact sentence only.');
    expect(buttons[0].getAttribute('data-tooltip-meta')).toBe('Line 12');
    expect(buttons[0].getAttribute('data-tooltip-kind')).toBe('llm-comment');
    expect(buttons[1].getAttribute('data-tooltip')).toBe('Note to Human: Reviewed the revision for clarity. (line 18)');
    expect(buttons[1].getAttribute('data-tooltip-kind')).toBe('human-comment');
  });

  it('removes stale comment and lock icons when the backing markers disappear', () => {
    const onJumpToLine = vi.fn();
    const lockedBlock: ProtectedBlock = {
      start: 5,
      end: 40,
      startLine: 3,
      endLine: 5,
      reason: 'approved',
      raw: '<!-- scie_md:lock:start -->\nlocked\n<!-- scie_md:lock:end -->',
      body: 'locked',
    };

    act(() => {
      renderRail(onJumpToLine, {
        protectedBlocks: [lockedBlock],
        editorComments: [
          {
            line: 8,
            audience: 'llm',
            body: 'Remove this after revision.',
            id: 'stale-note',
          },
        ],
      });
    });

    expect(container.querySelectorAll('.metadata-rail-item')).toHaveLength(2);

    act(() => {
      renderRail(onJumpToLine);
    });

    expect(container.querySelector('.metadata-rail')).toBeNull();
    expect(container.querySelectorAll('.metadata-rail-item')).toHaveLength(0);
  });
});

function renderRail(
  onJumpToLine = vi.fn(),
  overrides: Partial<{
    protectedBlocks: ProtectedBlock[];
    editorComments: EditorComment[];
  }> = {},
): void {
  root.render(
    <MetadataRail
      document={minimalDocument()}
      protectedBlocks={overrides.protectedBlocks ?? []}
      editorComments={overrides.editorComments ?? []}
      targetedInstructions={[]}
      variantGroups={[]}
      currentLine={1}
      onJumpToLine={onJumpToLine}
      onOpenReferences={() => undefined}
      onOpenData={() => undefined}
    />,
  );
}

function minimalDocument(): ParsedScienfyDocument {
  return {
    citations: {
      missingKeys: [],
      usages: [],
    },
    variables: {
      missingVariables: [],
      usages: [],
    },
  } as unknown as ParsedScienfyDocument;
}
