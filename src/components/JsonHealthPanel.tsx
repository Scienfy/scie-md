import { AlertTriangle, CheckCircle2, Database } from 'lucide-react';
import type { JsonDocumentAnalysis } from '../app/formatDiagnostics';
import type { FormatDiagnostic, JsonSchemaValidationResult, ObservedJsonShapeSummary } from '@sciemd/core';

export interface JsonHealthPanelProps {
  analysis: JsonDocumentAnalysis | null;
  selectedPath?: string | null;
  schemaLoading?: boolean;
  schemaError?: string | null;
  onSelectSchema?: () => void;
  onClearSchema?: () => void;
  onSelectedPathChange?: (path: string) => void;
}

export function JsonHealthPanel({
  analysis,
  selectedPath,
  schemaLoading = false,
  schemaError = null,
  onSelectSchema,
  onClearSchema,
  onSelectedPathChange,
}: JsonHealthPanelProps) {
  const parsed = analysis?.parseResult.parsed ?? null;
  const health = parsed?.health ?? null;
  const schemaValidation = parsed?.schemaValidation ?? null;
  const schemaDiagnostics = schemaValidation?.diagnostics ?? [];
  const healthDiagnostics = analysis?.parseResult.diagnostics.filter((diagnostic) => (
    diagnostic.severity !== 'error' && !diagnostic.code.startsWith('json-schema-')
  )) ?? [];

  return (
    <section className="inspector-section json-health-panel">
      <h2><Database size={15} />JSON health</h2>
      <div className={`json-health-status ${analysis?.status ?? 'invalid'}`}>
        {analysis?.status === 'valid' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        <strong>{statusLabel(analysis)}</strong>
      </div>
      {health && (
        <>
          <dl className="metadata-list json-health-grid">
            <div><dt>Top level</dt><dd>{health.topLevelType ?? 'unknown'}</dd></div>
            <div><dt>Nodes</dt><dd>{analysis?.nodeCount.toLocaleString() ?? '0'}</dd></div>
            <div><dt>Objects</dt><dd>{health.objectCount.toLocaleString()}</dd></div>
            <div><dt>Arrays</dt><dd>{health.arrayCount.toLocaleString()}</dd></div>
            <div><dt>Scalars</dt><dd>{health.scalarCount.toLocaleString()}</dd></div>
            <div><dt>Max depth</dt><dd>{health.maxDepth.toLocaleString()}</dd></div>
            <div><dt>Selected</dt><dd title={selectedPath ?? '$'}>{selectedPath ?? '$'}</dd></div>
            <div><dt>Tree budget</dt><dd>{analysis ? `${analysis.nodeCount.toLocaleString()} / ${analysis.treeBudget.toLocaleString()}` : '0'}</dd></div>
          </dl>
          {health.largestArrays.length > 0 && (
            <div className="json-health-subsection">
              <strong>Largest arrays</strong>
              <ul className="inspector-list">
                {health.largestArrays.slice(0, 4).map((array) => (
                  <li key={array.path}>
                    <span>{array.path}</span>
                    <small>{array.length.toLocaleString()} items</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {parsed && (
        <SchemaPanel
          schemaValidation={schemaValidation}
          schemaMetadataUri={parsed.schemaMetadata.uri}
          observedShape={parsed.observedShape}
          schemaLoading={schemaLoading}
          schemaError={schemaError}
          onSelectSchema={onSelectSchema}
          onClearSchema={onClearSchema}
        />
      )}
      {schemaDiagnostics.length > 0 && (
        <div className="json-health-subsection">
          <strong>Schema diagnostics</strong>
          <ul className="inspector-list">
            {schemaDiagnostics.slice(0, 8).map((diagnostic) => (
              <li key={`${diagnostic.code}-${diagnostic.message}`} className={diagnostic.severity}>
                <SchemaDiagnosticContent
                  diagnostic={diagnostic}
                  onSelectedPathChange={onSelectedPathChange}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {healthDiagnostics.length > 0 && (
        <div className="json-health-subsection">
          <strong>Warnings</strong>
          <ul className="inspector-list">
            {healthDiagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}-${diagnostic.offset ?? diagnostic.message}`} className="warning">
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SchemaDiagnosticContent({
  diagnostic,
  onSelectedPathChange,
}: {
  diagnostic: FormatDiagnostic;
  onSelectedPathChange?: (path: string) => void;
}) {
  if (!diagnostic.displayPath || !onSelectedPathChange) {
    return <span>{diagnostic.message}</span>;
  }
  return (
    <button
      type="button"
      className="inspector-list-action"
      onClick={() => onSelectedPathChange(diagnostic.displayPath ?? '$')}
    >
      <span>{diagnostic.message}</span>
      <small>{diagnostic.displayPath}</small>
    </button>
  );
}

function SchemaPanel({
  schemaValidation,
  schemaMetadataUri,
  observedShape,
  schemaLoading,
  schemaError,
  onSelectSchema,
  onClearSchema,
}: {
  schemaValidation: JsonSchemaValidationResult | null;
  schemaMetadataUri: string | null;
  observedShape: ObservedJsonShapeSummary;
  schemaLoading: boolean;
  schemaError: string | null;
  onSelectSchema?: () => void;
  onClearSchema?: () => void;
}) {
  const summary = schemaValidation?.summary ?? null;
  const profile = schemaValidation?.profile ?? summary?.profile ?? null;
  return (
    <div className="json-health-subsection">
      <div className="json-schema-header">
        <strong>Schema</strong>
        <div className="json-schema-actions">
          {onSelectSchema && <button type="button" onClick={onSelectSchema}>Select schema</button>}
          {schemaValidation && onClearSchema && <button type="button" onClick={onClearSchema}>Clear</button>}
        </div>
      </div>
      <dl className="metadata-list json-health-grid">
        <div><dt>Status</dt><dd>{schemaLoading ? 'loading' : schemaStatusLabel(schemaValidation)}</dd></div>
        <div><dt>Source</dt><dd title={schemaValidation?.source.path ?? schemaMetadataUri ?? ''}>{schemaValidation?.source.label ?? (schemaMetadataUri ? '$schema metadata' : 'not selected')}</dd></div>
        {schemaMetadataUri && <div><dt>$schema</dt><dd title={schemaMetadataUri}>{schemaMetadataUri}</dd></div>}
        {summary?.title && <div><dt>Title</dt><dd>{summary.title}</dd></div>}
        {profile && <div><dt>Draft</dt><dd title={profile.draftUri ?? ''}>{profile.draftLabel}</dd></div>}
        {profile && <div><dt>Local refs</dt><dd>{profile.localRefCount > 0 ? `${profile.localRefCount} resolved` : profile.localRefsSupported ? 'supported' : 'not supported'}</dd></div>}
        {profile?.remoteRefsIgnored && <div><dt>External refs</dt><dd title={profile.remoteRefTargets.join('\n')}>{profile.remoteRefCount} ignored</dd></div>}
        {profile?.unsupportedCompositionKeywords.length ? <div><dt>Composition</dt><dd>{profile.unsupportedCompositionKeywords.join(', ')}</dd></div> : null}
        {summary && <div><dt>Required</dt><dd>{summary.requiredFields.length ? summary.requiredFields.join(', ') : 'none'}</dd></div>}
        <div><dt>Observed</dt><dd>{observedShapeLabel(observedShape)}</dd></div>
      </dl>
      {schemaError && <p className="json-schema-error">{schemaError}</p>}
      {profile?.remoteRefsIgnored && (
        <p className="json-schema-error">External $ref targets are not fetched; ScieMD validates the local schema parts it can resolve.</p>
      )}
      {summary?.knownFields.length ? (
        <ul className="inspector-list">
          {summary.knownFields.slice(0, 6).map((field) => (
            <li key={field.path}>
              <span>{field.path}{field.type ? `: ${field.type}` : ''}{field.required ? ' required' : ''}</span>
              {field.description && <small>{field.description}</small>}
            </li>
          ))}
        </ul>
      ) : null}
      {summary?.enumFields.length ? (
        <ul className="inspector-list">
          {summary.enumFields.slice(0, 4).map((field) => (
            <li key={field.path}>
              <span>{field.path}</span>
              <small>{field.values.join(', ')}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function statusLabel(analysis: JsonDocumentAnalysis | null): string {
  if (!analysis || analysis.status === 'invalid') return 'Invalid JSON';
  if (analysis.status === 'too-large' || analysis.status === 'source-only') return 'Source mode';
  return 'Tree ready';
}

function schemaStatusLabel(schemaValidation: JsonSchemaValidationResult | null): string {
  if (!schemaValidation) return 'not selected';
  if (schemaValidation.status === 'valid') return 'valid';
  if (schemaValidation.status === 'schema-invalid') return 'schema unavailable';
  return 'invalid';
}

function observedShapeLabel(summary: ObservedJsonShapeSummary): string {
  if (summary.topLevelType === 'array') {
    const itemTypes = summary.arrayItemTypes.length ? summary.arrayItemTypes.join(', ') : 'empty';
    return `array of ${itemTypes}`;
  }
  if (summary.topLevelType === 'object') return `${summary.fields.length} observed fields`;
  return summary.topLevelType;
}
