import { describe, expect, it } from 'vitest';
import { createJsonContent, parseJsonDocument } from '../json/parseJsonDocument.js';
import { createLossyStructuredSourceMap } from './sourceMap.js';
import {
  structuredOperationForNode,
  structuredOperationsForNode,
  structuredPreviewDocumentOperations,
  structuredSourceRevealTargetForNode,
} from './structuredOperations.js';

describe('structured operation metadata', () => {
  it('creates reveal-source targets from parser-backed JSON node ranges', () => {
    const source = '{\n  "sample": {\n    "name": "Alpha"\n  }\n}\n';
    const parsed = parseJsonDocument(createJsonContent(source)).parsed;
    const node = parsed?.sourceMap.nodesByDisplayPath['$.sample.name'];

    const target = structuredSourceRevealTargetForNode(node);

    expect(target).toMatchObject({
      operationId: 'revealSource',
      format: 'json',
      pointer: '/sample/name',
      displayPath: '$.sample.name',
      from: source.indexOf('"Alpha"'),
      to: source.indexOf('"Alpha"') + '"Alpha"'.length,
      line: 3,
      column: 13,
      label: 'Reveal $.sample.name in source',
    });
  });

  it('reports source reveal unavailable for lossy projections without ranges', () => {
    const sourceMap = createLossyStructuredSourceMap('yaml', { sample: { name: 'Alpha' } });
    const node = sourceMap.nodesByDisplayPath['$.sample.name'];

    expect(structuredSourceRevealTargetForNode(node)).toBeNull();
    expect(structuredOperationForNode(node, 'revealSource')).toMatchObject({
      id: 'revealSource',
      enabled: false,
      disabledReason: 'This structured node does not have a source range.',
    });
  });

  it('adds clipboard and JSON edit operation metadata for a node', () => {
    const parsed = parseJsonDocument(createJsonContent('{"ok":true}')).parsed;
    const node = parsed?.sourceMap.nodesByDisplayPath['$.ok'];

    expect(structuredOperationsForNode(node, {
      jsonEditOperations: ['replaceScalar', 'renameObjectKey', 'deleteObjectField'],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'copyPath', group: 'clipboard', enabled: true }),
      expect.objectContaining({ id: 'copyJson', group: 'clipboard', enabled: true }),
      expect.objectContaining({ id: 'copyText', group: 'clipboard', enabled: true }),
      expect.objectContaining({ id: 'revealSource', group: 'navigation', enabled: true }),
      expect.objectContaining({ id: 'replaceScalar', label: 'Edit value', group: 'edit', requiresReview: true }),
      expect.objectContaining({ id: 'renameObjectKey', label: 'Rename key', group: 'edit', requiresReview: true }),
      expect.objectContaining({ id: 'deleteObjectField', label: 'Delete field', group: 'delete', destructive: true }),
    ]));
  });

  it('creates document-level clipboard replacement metadata for read-only previews', () => {
    expect(structuredPreviewDocumentOperations({
      canApplyClipboardReplace: true,
      disabledReason: 'not used',
      requiresOptIn: true,
    })).toContainEqual(expect.objectContaining({
      id: 'applyClipboardReplace',
      group: 'document',
      enabled: true,
      destructive: true,
      requiresReview: true,
      requiresOptIn: true,
      readonlyPreview: true,
    }));

    expect(structuredPreviewDocumentOperations({
      canApplyClipboardReplace: false,
      disabledReason: 'YAML is preview-only.',
    })).toContainEqual(expect.objectContaining({
      id: 'applyClipboardReplace',
      enabled: false,
      disabledReason: 'YAML is preview-only.',
    }));
  });
});
