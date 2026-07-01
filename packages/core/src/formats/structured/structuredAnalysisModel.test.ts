import { describe, expect, it } from 'vitest';
import { adapterForFormat } from '../registry.js';
import {
  structuredAnalysisCanRenderSurface,
  structuredAnalysisHasDeclaredSurface,
  structuredSurfaceForKind,
  type StructuredAnalysisModel,
} from './structuredAnalysisModel.js';

describe('structured analysis model helpers', () => {
  it('reads visual surface declarations from core format adapters', () => {
    expect(structuredSurfaceForKind(adapterForFormat('json')?.capabilities.visualSurfaces ?? [], 'tree')).toMatchObject({
      kind: 'tree',
      editable: true,
      preservesSource: true,
      lossy: false,
    });
    expect(structuredSurfaceForKind(adapterForFormat('yaml')?.capabilities.visualSurfaces ?? [], 'tree')).toMatchObject({
      kind: 'tree',
      readonly: true,
      editable: false,
      lossy: true,
    });
    expect(structuredSurfaceForKind(adapterForFormat('csv')?.capabilities.visualSurfaces ?? [], 'table')).toMatchObject({
      kind: 'table',
      editable: true,
    });
  });

  it('distinguishes declared surfaces from renderable surfaces', () => {
    const surface = structuredSurfaceForKind(adapterForFormat('json')?.capabilities.visualSurfaces ?? [], 'tree');
    const model = {
      format: 'json',
      status: 'too-large',
      diagnostics: [],
      parseResult: {
        format: 'json',
        content: { format: 'json', text: '{}', path: null },
        parsed: null,
        diagnostics: [],
        sourceOnly: true,
      },
      visualSurfaces: surface ? [surface] : [],
      primaryVisualSurface: surface,
      canRenderVisualSurface: false,
      metrics: { nodeCount: 3000, treeBudget: 2500 },
      editPolicy: 'format-preserving',
      preservationPolicy: 'lossless-parse',
      sourceOnly: true,
    } satisfies StructuredAnalysisModel;

    expect(structuredAnalysisHasDeclaredSurface(model, 'tree')).toBe(true);
    expect(structuredAnalysisCanRenderSurface(model, 'tree')).toBe(false);
  });
});
