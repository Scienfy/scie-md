import { describe, expect, it } from 'vitest';
import { createStructuredSavePolicy, formatStructuredSaveConfirmation } from './structuredSavePolicy';

describe('structuredSavePolicy', () => {
  it('blocks autosave for parser errors in structured formats', () => {
    const policy = createStructuredSavePolicy({
      format: 'json',
      diagnostics: [{
        severity: 'error',
        code: 'json-syntax',
        message: 'Property name expected.',
        source: 'json',
        category: 'parser',
        line: 3,
        column: 2,
      }],
    });

    expect(policy.autosaveBlocked).toBe(true);
    expect(policy.manualSaveRequiresConfirmation).toBe(true);
    expect(policy.reason).toBe('Autosave paused: JSON syntax is invalid at line 3, column 2.');
  });

  it('does not block autosave for schema, health, or Markdown diagnostics', () => {
    expect(createStructuredSavePolicy({
      format: 'json',
      diagnostics: [{
        severity: 'error',
        code: 'json-schema-required',
        message: 'Required field missing.',
        source: 'json',
        category: 'schema',
      }],
    }).autosaveBlocked).toBe(false);

    expect(createStructuredSavePolicy({
      format: 'markdown',
      diagnostics: [{
        severity: 'error',
        code: 'frontmatter-yaml',
        message: 'Invalid frontmatter.',
        source: 'markdown',
        category: 'parser',
      }],
    }).autosaveBlocked).toBe(false);
  });

  it('formats explicit manual save confirmation copy', () => {
    const policy = createStructuredSavePolicy({
      format: 'yaml',
      diagnostics: [{
        severity: 'error',
        code: 'yaml-syntax',
        message: 'Nested mappings are not allowed here.',
        source: 'yaml',
        category: 'parser',
        line: 8,
      }],
    });

    expect(formatStructuredSaveConfirmation(policy)).toMatchObject({
      title: 'Save invalid YAML source?',
      okLabel: 'Save Anyway',
    });
  });
});
