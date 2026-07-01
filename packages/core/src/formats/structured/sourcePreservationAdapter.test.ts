import { describe, expect, it } from 'vitest';
import type { SourceSpan } from '../documentFormat.js';
import {
  applySourcePreservationPatches,
  compareUntouchedSourceRegions,
  createDisabledSourcePreservationAnalysis,
  createExpectedOldSourceGuard,
  createUnsupportedSourcePreservationEditPlan,
  evaluateNoOpRoundTrip,
  sourceByteLength,
  sourcePreservationFeature,
  sourcePreservationHash,
  validateSourcePreservationGuards,
  visualWritesEnabledForSourcePreservationFormat,
} from './sourcePreservationAdapter.js';

describe('source preservation adapter contract', () => {
  it('creates deterministic source hashes and byte lengths for guard checks', () => {
    const ascii = 'title: Alpha\n';
    const unicode = `label: ${String.fromCodePoint(0x3bc)}-film\n`;

    expect(sourcePreservationHash(ascii)).toBe(sourcePreservationHash(ascii));
    expect(sourcePreservationHash(ascii)).not.toBe(sourcePreservationHash(`${ascii}# comment\n`));
    expect(sourceByteLength(unicode)).toBeGreaterThan(unicode.length);
    expect(sourcePreservationHash(unicode)).toMatch(/^fnv1a32:[0-9a-f]{8}:\d+$/);
  });

  it('keeps no-op round-trip evidence explicit', () => {
    const source = 'title = "Dataset"\n# keep\n';
    expect(evaluateNoOpRoundTrip(source, source)).toMatchObject({
      preserved: true,
      sourceHash: sourcePreservationHash(source),
      serializedHash: sourcePreservationHash(source),
    });
    expect(evaluateNoOpRoundTrip(source, source.replace('# keep', '# moved'))).toMatchObject({
      preserved: false,
    });
  });

  it('validates source hash and expected old token before a patch is trusted', () => {
    const source = 'study:\n  title: Alpha\n';
    const span = spanFor(source, 'Alpha');
    const request = {
      sourceHash: sourcePreservationHash(source),
      expectedOldSource: createExpectedOldSourceGuard(source, span),
      span,
    };

    expect(validateSourcePreservationGuards(source, request)).toEqual({ ok: true, diagnostics: [] });
    expect(validateSourcePreservationGuards(source.replace('Alpha', 'Beta'), request)).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({ code: 'source-preservation-hash-mismatch' }),
        expect.objectContaining({ code: 'source-preservation-expected-old-source-mismatch' }),
      ],
    });
  });

  it('applies source patches only when expected old source still matches', () => {
    const source = 'study:\n  title: Alpha\n  status: draft\n';
    const titleSpan = spanFor(source, 'Alpha');
    const patch = {
      span: titleSpan,
      expectedOldSource: 'Alpha',
      replacementSource: 'Beta',
    };

    const applied = applySourcePreservationPatches(source, [patch]);
    expect(applied).toEqual({ ok: true, sourceText: 'study:\n  title: Beta\n  status: draft\n' });
    if (applied.ok) {
      expect(compareUntouchedSourceRegions(source, applied.sourceText, [patch])).toMatchObject({
        ok: true,
        checkedRegionCount: 2,
        mismatches: [],
      });
    }
    expect(applySourcePreservationPatches(source.replace('Alpha', 'Gamma'), [patch])).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'source-preservation-patch-expected-old-source-mismatch' })],
    });
  });

  it('rejects overlapping patches and detects unrelated source changes', () => {
    const source = 'a = 1\nb = 2\nc = 3\n';
    const first = { span: spanFor(source, '1'), replacementSource: '10' };
    const overlapping = { span: { offset: first.span.offset, length: 2 }, replacementSource: '11' };

    expect(applySourcePreservationPatches(source, [first, overlapping])).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'source-preservation-overlapping-patches' })],
    });

    const nextWithUnrelatedMutation = source.replace('1', '10').replace('c = 3', 'c = 4');
    expect(compareUntouchedSourceRegions(source, nextWithUnrelatedMutation, [first])).toMatchObject({
      ok: false,
      mismatches: [expect.objectContaining({ expected: '\nb = 2\nc = 3\n', actual: '\nb = 2\nc = 4\n' })],
    });
  });

  it('creates disabled adapter analysis for YAML, TOML, and XML without enabling visual writes', () => {
    const feature = sourcePreservationFeature('comment', 'yaml-comment-readonly', 'Comment must be preserved.');
    const analysis = createDisabledSourcePreservationAnalysis({
      format: 'yaml',
      sourceText: '# keep\nname: Alpha\n',
      sourceMap: null,
      unsupportedFeatures: [feature],
      noOpSerializedText: '# keep\nname: Alpha\n',
      rationale: ['Fixture-backed edit planning is still missing.'],
    });

    expect(analysis).toMatchObject({
      format: 'yaml',
      adapterStatus: 'read-only',
      visualWritesEnabled: false,
      unsupportedFeatureCount: 1,
      unsupportedKinds: ['comment'],
      decision: 'defer-visual-writes',
      noOpRoundTrip: expect.objectContaining({ preserved: true }),
    });
    expect(analysis.requiredGuards).toEqual(expect.arrayContaining([
      'source-hash',
      'expected-old-source',
      'raw-token',
      'post-parse-validation',
      'unsupported-feature-gate',
      'untouched-region-compare',
    ]));
    expect(visualWritesEnabledForSourcePreservationFormat('yaml')).toBe(false);
    expect(visualWritesEnabledForSourcePreservationFormat('toml')).toBe(false);
    expect(visualWritesEnabledForSourcePreservationFormat('xml')).toBe(false);
  });

  it('returns explicit unsupported plans for read-only preservation adapters', () => {
    expect(createUnsupportedSourcePreservationEditPlan('xml', 'XML namespace-safe writes are not implemented.')).toMatchObject({
      status: 'unsupported',
      reason: 'XML namespace-safe writes are not implemented.',
      diagnostics: [expect.objectContaining({
        code: 'xml-visual-write-disabled',
        category: 'preservation',
        blocking: false,
      })],
    });
  });
});

function spanFor(source: string, token: string): SourceSpan {
  const offset = source.indexOf(token);
  if (offset < 0) throw new Error(`Missing token ${token}`);
  const line = source.slice(0, offset).split('\n').length;
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return {
    offset,
    length: token.length,
    line,
    column: offset - lineStart + 1,
  };
}
