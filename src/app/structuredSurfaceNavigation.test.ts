import { describe, expect, it } from 'vitest';
import { formatCapabilitiesFor } from './formatCapabilities';
import { parseSourceFormatDiagnostics } from './formatDiagnostics';
import { createStructuredSurfaceNavigationModel } from './structuredSurfaceNavigation';

describe('createStructuredSurfaceNavigationModel', () => {
  it('exposes JSON tree, array, health, and source surfaces when an object array is available', () => {
    const source = '{"samples":[{"id":"S-001"},{"id":"S-002"}]}';
    const analysis = parseSourceFormatDiagnostics('json', source, null).jsonAnalysis;
    const model = createStructuredSurfaceNavigationModel({
      format: 'json',
      mode: 'visual',
      formatCapabilities: formatCapabilitiesFor('json'),
      preferredVisualSurface: 'table',
      jsonAnalysis: analysis,
      jsonArrayTableAvailable: true,
    });

    expect(model.activeSurface).toBe('table');
    expect(model.surfaces.map((surface) => [surface.id, surface.enabled])).toEqual([
      ['tree', true],
      ['table', true],
      ['cards', true],
      ['health', true],
      ['source', true],
    ]);
  });

  it('keeps unavailable JSON array surfaces disabled with a concrete reason', () => {
    const analysis = parseSourceFormatDiagnostics('json', '{"study":{"id":"S-001"}}', null).jsonAnalysis;
    const model = createStructuredSurfaceNavigationModel({
      format: 'json',
      mode: 'visual',
      formatCapabilities: formatCapabilitiesFor('json'),
      preferredVisualSurface: 'table',
      jsonAnalysis: analysis,
      jsonArrayTableAvailable: false,
    });

    expect(model.activeSurface).toBe('tree');
    expect(model.surfaces.find((surface) => surface.id === 'table')).toMatchObject({
      enabled: false,
      disabledReason: 'No table-shaped object array is selected or discoverable.',
    });
  });

  it('falls back to source for invalid structured documents', () => {
    const analysis = parseSourceFormatDiagnostics('yaml', 'sample: [\n', null).structuredAnalysis;
    const model = createStructuredSurfaceNavigationModel({
      format: 'yaml',
      mode: 'visual',
      formatCapabilities: formatCapabilitiesFor('yaml'),
      preferredVisualSurface: 'tree',
      structuredAnalysis: analysis,
    });

    expect(model.activeSurface).toBe('source');
    expect(model.surfaces.find((surface) => surface.id === 'tree')).toMatchObject({
      enabled: false,
      disabledReason: 'Fix parser errors before using the structured view.',
    });
  });

  it('uses source as the active surface without discarding the preferred visual surface', () => {
    const analysis = parseSourceFormatDiagnostics('csv', 'id,count\nS-001,12\n', null).tabularAnalysis;
    const model = createStructuredSurfaceNavigationModel({
      format: 'csv',
      mode: 'source',
      formatCapabilities: formatCapabilitiesFor('csv'),
      preferredVisualSurface: 'table',
      tabularAnalysis: analysis,
    });

    expect(model.activeSurface).toBe('source');
    expect(model.preferredVisualSurface).toBe('table');
    expect(model.visualSurfaces[0]).toMatchObject({ id: 'table', enabled: true });
  });
});
