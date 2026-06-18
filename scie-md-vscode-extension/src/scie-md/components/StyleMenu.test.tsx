import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISUAL_STYLE_OPTIONS } from '../services/visualStyleService';
import { StyleMenu } from './StyleMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('StyleMenu', () => {
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

  it('renders every visual style as a text-only row, including Claude', () => {
    act(() => {
      root.render(
        <StyleMenu
          currentStyle={{ label: 'Scienfy', shortLabel: 'Scienfy' }}
          selectedStyleId="scienfy"
          open
          onToggle={() => undefined}
          onSelect={vi.fn()}
        />,
      );
    });

    for (const style of VISUAL_STYLE_OPTIONS) {
      expect(container.textContent).toContain(style.label);
    }
    expect(container.querySelectorAll('.style-preview')).toHaveLength(0);
  });
});
