import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXPORT_OPTIONS } from '../../export/exportTypes';
import { createStyledExportHtml } from './useExportActions';

describe('createStyledExportHtml', () => {
  it('fails loudly instead of using a second renderer when visual capture is unavailable', async () => {
    const pushToast = vi.fn();
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      flush: vi.fn(),
    };

    await expect(createStyledExportHtml({
      markdown: '# Fallback export\n\nBody text.',
      filePath: null,
      variableDefinitions: [],
      citationEntries: [],
      themeMode: 'dark',
      resolvedTheme: 'dark',
      visualStyle: 'scienfy',
      fontScale: 1,
      exportOptions: DEFAULT_EXPORT_OPTIONS,
      captureVisualHtml: () => null,
      renderVisualExportHtml: async () => null,
      pushToast,
      log,
    })).rejects.toThrow('Visual export capture failed');

    expect(log.error).toHaveBeenCalledWith('render', expect.stringContaining('different renderer'));
    expect(log.warn).not.toHaveBeenCalledWith('render', expect.stringContaining('Markdown fallback'));
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('different renderer'), 'error');
  });
});
