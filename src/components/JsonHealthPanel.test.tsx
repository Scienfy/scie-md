import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSourceFormatDiagnostics } from '../app/formatDiagnostics';
import { JsonHealthPanel } from './JsonHealthPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('JsonHealthPanel', () => {
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

  it('renders parser health, budget, largest arrays, and selected path', () => {
    const analysis = parseSourceFormatDiagnostics(
      'json',
      '{"samples":[{"name":"A"},{"name":"B"}],"ok":true}',
      'C:\\lab\\results.json',
    ).jsonAnalysis;

    renderPanel(analysis, '$.samples[1]');

    expect(container.textContent).toContain('Tree ready');
    expect(container.textContent).toContain('Top level');
    expect(container.textContent).toContain('$.samples[1]');
    expect(container.textContent).toContain('$.samples');
    expect(container.textContent).toContain('2 items');
  });

  it('shows invalid parser status without health stats', () => {
    const analysis = parseSourceFormatDiagnostics('json', '{"samples": [}', null).jsonAnalysis;

    renderPanel(analysis, '$');

    expect(container.textContent).toContain('Invalid JSON');
    expect(container.textContent).not.toContain('Largest arrays');
  });

  it('shows source mode for JSON documents over the parser byte budget', () => {
    const analysis = parseSourceFormatDiagnostics('json', `{"payload":"${'x'.repeat(1024 * 1024 + 1)}"}`, null).jsonAnalysis;

    renderPanel(analysis, '$');

    expect(container.textContent).toContain('Source mode');
    expect(container.textContent).toContain('visual inspection is disabled');
    expect(container.textContent).not.toContain('Largest arrays');
  });

  it('renders schema status, schema diagnostics, and observed shape separately', () => {
    const onSelectSchema = vi.fn();
    const onClearSchema = vi.fn();
    const onSelectedPathChange = vi.fn();
    const analysis = parseSourceFormatDiagnostics('json', '{"count":"2","values":[1,"two"]}', null, {
      jsonSchema: {
        kind: 'explicit',
        path: 'C:\\lab\\result.schema.json',
        text: JSON.stringify({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          title: 'Dataset schema',
          $defs: {
            id: { type: 'string' },
          },
          type: 'object',
          required: ['id'],
          properties: {
            id: { $ref: '#/$defs/id' },
            count: { type: 'number', description: 'Observed count.' },
            external: { $ref: 'https://example.test/external.schema.json' },
            choice: { oneOf: [{ type: 'string' }, { type: 'number' }] },
          },
        }),
      },
    }).jsonAnalysis;

    act(() => {
      root.render(
        <JsonHealthPanel
          analysis={analysis}
          selectedPath="$"
          onSelectSchema={onSelectSchema}
          onClearSchema={onClearSchema}
          onSelectedPathChange={onSelectedPathChange}
        />,
      );
    });

    expect(container.textContent).toContain('Schema');
    expect(container.textContent).toContain('invalid');
    expect(container.textContent).toContain('Dataset schema');
    expect(container.textContent).toContain('2020-12');
    expect(container.textContent).toContain('1 resolved');
    expect(container.textContent).toContain('1 ignored');
    expect(container.textContent).toContain('oneOf');
    expect(container.textContent).toContain('External $ref targets are not fetched');
    expect(container.textContent).toContain('Missing required field $.id.');
    expect(container.textContent).toContain('Expected $.count to be number.');
    expect(container.textContent).toContain('2 observed fields');
    expect(container.textContent).toContain('Array at $.values contains mixed value types (number, string).');

    clickButton('Select schema');
    clickButton('Clear');
    clickButton('Expected $.count to be number.');
    expect(onSelectSchema).toHaveBeenCalledTimes(1);
    expect(onClearSchema).toHaveBeenCalledTimes(1);
    expect(onSelectedPathChange).toHaveBeenCalledWith('$.count');
  });
});

function renderPanel(analysis: ReturnType<typeof parseSourceFormatDiagnostics>['jsonAnalysis'], selectedPath: string) {
  act(() => {
    root.render(<JsonHealthPanel analysis={analysis} selectedPath={selectedPath} />);
  });
}

function clickButton(text: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.textContent?.includes(text));
  expect(button, `button "${text}"`).not.toBeUndefined();
  act(() => {
    button?.click();
  });
}
