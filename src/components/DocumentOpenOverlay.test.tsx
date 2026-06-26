import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocumentOpenStatus } from '../app/documentOpenStatus';
import { DocumentOpenOverlay } from './DocumentOpenOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('DocumentOpenOverlay', () => {
  let container: HTMLDivElement;
  let root: Root;

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

  it('does not render when no open status is active', () => {
    act(() => {
      root.render(<DocumentOpenOverlay status={null} />);
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('announces the document open progress with the file name', () => {
    act(() => {
      root.render(
        <DocumentOpenOverlay status={createDocumentOpenStatus('C:\\Users\\amin_\\large-paper.md', 'preparing')} />,
      );
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(status?.textContent).toContain('Preparing document view');
    expect(status?.textContent).toContain('large-paper.md');
    expect(container.querySelector('.document-open-spinner')).not.toBeNull();
  });
});
