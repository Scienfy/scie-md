import { describe, expect, it } from 'vitest';
import {
  SCIEMD_TEMPLATES,
  createScienfyTemplate,
  preferredTemplateMode,
  templateFormat,
} from './templates';

describe('new document starters', () => {
  it('exposes only format starters in the active chooser', () => {
    const ids = SCIEMD_TEMPLATES.map((template) => template.id);

    expect(ids).toEqual([
      'blank-markdown',
      'json',
      'jsonl',
      'yaml',
      'toml',
      'xml',
      'csv',
      'tsv',
      'plain-text',
    ]);
    expect(ids).not.toContain('paper');
    expect(ids).not.toContain('research-statement');
    expect(ids).not.toContain('lab-note');
  });

  it('creates a minimal Markdown starter instead of an empty document', () => {
    expect(createScienfyTemplate('blank-markdown')).toBe('# Header\n\nMain text\n');
    expect(templateFormat('blank-markdown')).toBe('markdown');
    expect(preferredTemplateMode('blank-markdown')).toBe('visual');
  });

  it('creates valid structured starters for the write-supported formats', () => {
    expect(() => JSON.parse(createScienfyTemplate('json'))).not.toThrow();
    for (const line of createScienfyTemplate('jsonl').trim().split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    expect(createScienfyTemplate('yaml')).toContain('document:');
    expect(createScienfyTemplate('toml')).toContain('[document]');
    expect(createScienfyTemplate('xml')).toContain('<document>');
    expect(createScienfyTemplate('csv')).toBe('id,name,value\nitem-001,Main item,\n');
    expect(createScienfyTemplate('tsv')).toBe('id\tname\tvalue\nitem-001\tMain item\t\n');
    expect(createScienfyTemplate('plain-text')).toBe('Header\n\nMain text\n');
    expect(preferredTemplateMode('plain-text')).toBe('source');
  });
});
