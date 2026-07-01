import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentFormat } from '@sciemd/core';
import { jsonSchemaSiblingCandidates, useJsonSchemaDiscovery } from './useJsonSchemaDiscovery';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookState = ReturnType<typeof useJsonSchemaDiscovery>;

describe('useJsonSchemaDiscovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: HookState | null;
  let readTextFile: ReturnType<typeof vi.fn<(path: string) => Promise<{ content: string }>>>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    latestState = null;
    readTextFile = vi.fn<(path: string) => Promise<{ content: string }>>();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('uses an explicit selected schema before sibling discovery', async () => {
    readTextFile.mockResolvedValue({ content: '{"type":"object"}' });

    renderHook({
      explicitSchemaPath: 'C:\\lab\\selected.schema.json',
    });
    await flushAsync();

    expect(readTextFile).toHaveBeenCalledWith('C:\\lab\\selected.schema.json');
    expect(latestState?.schemaSource).toMatchObject({
      kind: 'explicit',
      path: 'C:\\lab\\selected.schema.json',
      text: '{"type":"object"}',
    });
  });

  it('tries sibling schema names silently until one loads', async () => {
    readTextFile
      .mockRejectedValueOnce(new Error('File access denied'))
      .mockResolvedValueOnce({ content: '{"required":["id"]}' });

    renderHook({});
    await flushAsync();

    expect(readTextFile).toHaveBeenNthCalledWith(1, 'C:\\lab\\result.schema.json');
    expect(readTextFile).toHaveBeenNthCalledWith(2, 'C:\\lab\\result.json.schema.json');
    expect(latestState?.schemaSource).toMatchObject({
      kind: 'sibling',
      path: 'C:\\lab\\result.json.schema.json',
      text: '{"required":["id"]}',
    });
  });

  it('does not discover schemas for non-JSON formats', async () => {
    renderHook({ format: 'yaml', filePath: 'C:\\lab\\result.yaml' });
    await flushAsync();

    expect(readTextFile).not.toHaveBeenCalled();
    expect(latestState?.schemaSource).toBeNull();
    expect(latestState?.loading).toBe(false);
  });

  it('builds stable sibling candidates for Windows and POSIX paths', () => {
    expect(jsonSchemaSiblingCandidates('C:\\lab\\result.json')).toEqual([
      'C:\\lab\\result.schema.json',
      'C:\\lab\\result.json.schema.json',
      'C:\\lab\\schema.json',
    ]);
    expect(jsonSchemaSiblingCandidates('/lab/result.json')).toEqual([
      '/lab/result.schema.json',
      '/lab/result.json.schema.json',
      '/lab/schema.json',
    ]);
  });

  function renderHook(options: {
    format?: DocumentFormat;
    filePath?: string | null;
    explicitSchemaPath?: string | null;
  }) {
    act(() => {
      root.render(
        <Harness
          format={options.format ?? 'json'}
          filePath={options.filePath ?? 'C:\\lab\\result.json'}
          explicitSchemaPath={options.explicitSchemaPath ?? null}
          readTextFile={readTextFile}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });
  }
});

function Harness({
  format,
  filePath,
  explicitSchemaPath,
  readTextFile,
  onState,
}: {
  format: DocumentFormat;
  filePath: string | null;
  explicitSchemaPath: string | null;
  readTextFile: ReturnType<typeof vi.fn<(path: string) => Promise<{ content: string }>>>;
  onState: (state: HookState) => void;
}) {
  const state = useJsonSchemaDiscovery({
    format,
    filePath,
    explicitSchemaPath,
    fileHost: {
      readTextFile,
    },
  });
  onState(state);
  return null;
}

async function flushAsync() {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
