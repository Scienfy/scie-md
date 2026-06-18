import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocumentTypeDialog } from './DocumentTypeDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('DocumentTypeDialog', () => {
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

  it('explains writing defaults without making the choice feel permanent', () => {
    act(() => {
      root.render(<DocumentTypeDialog open onSelect={() => undefined} onSkip={() => undefined} />);
    });

    expect(container.textContent).toContain('Choose a starting layout');
    expect(container.textContent).toContain('change this later in Settings');
    expect(container.textContent).toContain('Keep defaults');
    expect(container.textContent).toContain('Report or manuscript');
  });
});
