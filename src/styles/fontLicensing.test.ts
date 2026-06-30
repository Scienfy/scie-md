import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appCssModuleOrder } from './appCssBundle';

const productionFontFiles = [
  'src/styles/app.css',
  ...appCssModuleOrder.map((fileName) => `src/styles/${fileName}`),
  'src/styles/scientific-document.css',
  'src/styles/appCssBundle.ts',
  'src/markdown/htmlExport.ts',
  'src/app/App.tsx',
  'src/app/hooks/useSlashCommandMenu.ts',
  'src/samples/welcome.md',
  'public/assets/scie-md-workflow.svg',
];

const proprietaryFontNames = [
  'Aptos',
  'Aptos Display',
  'Segoe UI',
  'Segoe UI Symbol',
  'Georgia',
  'Times New Roman',
  'Iowan Old Style',
  'Arial',
  'Helvetica',
  'Consolas',
  'SFMono-Regular',
  'Apple Color Emoji',
  'Inter',
];

describe('production font stacks', () => {
  it('do not reference proprietary named fonts', () => {
    const root = process.cwd();
    const failures: string[] = [];

    for (const file of productionFontFiles) {
      const contents = readFileSync(join(root, file), 'utf8');
      for (const fontName of proprietaryFontNames) {
        const escaped = fontName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const namedFontPattern = new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`);
        if (namedFontPattern.test(contents)) {
          failures.push(`${file}: ${fontName}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
