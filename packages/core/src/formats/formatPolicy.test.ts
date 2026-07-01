import { describe, expect, it } from 'vitest';
import type { DocumentFormat } from './documentFormat.js';
import {
  editableStructuredSurfaces,
  formatExceedsParseBudget,
  formatRuntimePolicyFor,
} from './formatPolicy.js';
import { registeredFormatAdapters } from './registry.js';

describe('format runtime policy', () => {
  it('keeps adapter declarations internally consistent', () => {
    for (const adapter of registeredFormatAdapters()) {
      const { capabilities } = adapter;
      expect(capabilities.defaultMode === 'visual' || capabilities.defaultMode === 'source').toBe(true);
      expect(capabilities.sourceEditor.languageId).toBe(adapter.format);
      expect(capabilities.sourceEditor.contextMenuOperations).toContain('copyLine');
      expect(capabilities.sourceEditor.lintProfile).not.toBe('none');
      if (capabilities.parseBudgetBytes !== undefined) {
        expect(capabilities.parseBudgetBytes).toBeGreaterThan(0);
        expect(capabilities.sourceEditor.sourceOnlyThresholdBytes).toBe(capabilities.parseBudgetBytes);
      }
      if (capabilities.sourceOnlyFileBytes !== undefined) {
        expect(capabilities.sourceOnlyFileBytes).toBeGreaterThan(0);
      }
      const policy = formatRuntimePolicyFor(adapter.format);
      expect(policy.defaultMode).toBe(capabilities.defaultMode);
      expect(policy.parseBudgetBytes).toBe(capabilities.parseBudgetBytes ?? null);
      expect(policy.sourceOnlyFileBytes).toBe(capabilities.sourceOnlyFileBytes ?? capabilities.parseBudgetBytes ?? null);

      const editableSurfaces = editableStructuredSurfaces(capabilities);
      if (editableSurfaces.length > 0) {
        expect(capabilities.sourceEditing).toBe(true);
        expect(capabilities.visualEditing).toBe(true);
        expect(capabilities.formatPreservingEdits).toBe(true);
        expect(capabilities.editPolicy).toBe('format-preserving');
        for (const surface of editableSurfaces) {
          expect(surface.readonly).toBe(false);
          expect(surface.preservesSource).toBe(true);
        }
        expect(policy.canEditVisually).toBe(true);
      } else {
        expect(capabilities.visualEditing).toBe(false);
        expect(capabilities.formatPreservingEdits).toBe(false);
        expect(policy.canEditVisually).toBe(false);
      }
    }
  });

  it('derives visual editability from adapter capabilities instead of format names', () => {
    expect(formatRuntimePolicyFor('json')).toMatchObject({
      canOpenAsDocument: true,
      canPreview: true,
      canUseVisualTree: true,
      canEditVisually: true,
      canApplyClipboardReplace: true,
    });
    expect(formatRuntimePolicyFor('jsonl')).toMatchObject({
      canOpenAsDocument: true,
      canPreview: true,
      canUseRecordList: true,
      canEditVisually: true,
      canApplyClipboardReplace: true,
    });
    expect(formatRuntimePolicyFor('csv')).toMatchObject({
      canOpenAsDocument: true,
      canPreview: true,
      canUseTablePreview: true,
      canEditVisually: true,
      canApplyClipboardReplace: false,
    });
    expect(formatRuntimePolicyFor('yaml')).toMatchObject({
      canPreview: true,
      canUseVisualTree: true,
      canEditVisually: false,
    });
  });

  it('applies parse budget checks to every adapter that declares a budget', () => {
    const budgetedFormats = registeredFormatAdapters()
      .filter((adapter) => adapter.capabilities.parseBudgetBytes !== undefined)
      .map((adapter) => adapter.format);

    expect(budgetedFormats).toEqual(expect.arrayContaining([
      'json',
      'jsonl',
      'yaml',
      'toml',
      'xml',
      'csv',
      'tsv',
    ] satisfies DocumentFormat[]));

    for (const adapter of registeredFormatAdapters()) {
      const budget = adapter.capabilities.parseBudgetBytes;
      if (budget === undefined) continue;
      expect(formatExceedsParseBudget(adapter.format, 'x'.repeat(budget + 1))).toBe(true);
      expect(formatExceedsParseBudget(adapter.format, 'x'.repeat(Math.max(0, budget - 1)))).toBe(false);
    }
  });

  it('declares source editor behavior for highlighted and plain-text formats', () => {
    const adapters = Object.fromEntries(registeredFormatAdapters().map((adapter) => [adapter.format, adapter]));

    expect(adapters.json?.capabilities.sourceEditor).toMatchObject({
      codeMirrorLanguage: 'json',
      codeMirrorLanguageAvailable: true,
      diagnosticsRangeSupport: 'offset',
    });
    expect(adapters.yaml?.capabilities.sourceEditor).toMatchObject({
      codeMirrorLanguage: 'yaml',
      codeMirrorLanguageAvailable: true,
      commentSyntax: 'yaml',
    });
    expect(adapters.xml?.capabilities.sourceEditor).toMatchObject({
      codeMirrorLanguage: 'xml',
      codeMirrorLanguageAvailable: true,
      commentSyntax: 'xml',
    });
    expect(adapters.toml?.capabilities.sourceEditor).toMatchObject({
      codeMirrorLanguage: 'plainText',
      codeMirrorLanguageAvailable: false,
      commentSyntax: 'toml',
    });
    expect(adapters.csv?.capabilities.sourceEditor.contextMenuOperations).toContain('convertSelection');
    expect(adapters.tsv?.capabilities.sourceEditor.languageId).toBe('tsv');
  });
});
