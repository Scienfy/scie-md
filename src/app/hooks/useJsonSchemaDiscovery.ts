import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentFormat, JsonSchemaSource } from '@sciemd/core';

export interface JsonSchemaDiscoveryState {
  schemaSource: JsonSchemaSource | null;
  loading: boolean;
  error: string | null;
  siblingCandidates: string[];
}

interface UseJsonSchemaDiscoveryOptions {
  format: DocumentFormat;
  filePath: string | null;
  explicitSchemaPath: string | null;
  fileHost: {
    readTextFile(path: string): Promise<{ content: string }>;
  };
}

export function useJsonSchemaDiscovery({
  format,
  filePath,
  explicitSchemaPath,
  fileHost,
}: UseJsonSchemaDiscoveryOptions): JsonSchemaDiscoveryState {
  const requestRef = useRef(0);
  const readTextFile = fileHost.readTextFile;
  const siblingCandidates = useMemo(
    () => format === 'json' && filePath ? jsonSchemaSiblingCandidates(filePath) : [],
    [filePath, format],
  );
  const [state, setState] = useState<JsonSchemaDiscoveryState>({
    schemaSource: null,
    loading: false,
    error: null,
    siblingCandidates: [],
  });

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (format !== 'json') {
      setState({ schemaSource: null, loading: false, error: null, siblingCandidates: [] });
      return undefined;
    }

    setState((current) => ({
      schemaSource: current.schemaSource,
      loading: true,
      error: null,
      siblingCandidates,
    }));

    void (async () => {
      if (explicitSchemaPath) {
        const response = await readTextFile(explicitSchemaPath);
        if (requestId !== requestRef.current) return;
        setState({
          schemaSource: {
            kind: 'explicit',
            path: explicitSchemaPath,
            text: response.content,
            label: 'Selected schema',
          },
          loading: false,
          error: null,
          siblingCandidates,
        });
        return;
      }

      for (const candidate of siblingCandidates) {
        try {
          const response = await readTextFile(candidate);
          if (requestId !== requestRef.current) return;
          setState({
            schemaSource: {
              kind: 'sibling',
              path: candidate,
              text: response.content,
              label: 'Sibling schema',
            },
            loading: false,
            error: null,
            siblingCandidates,
          });
          return;
        } catch {
          // Missing or ungranted sibling schemas are expected. Keep discovery silent.
        }
      }

      if (requestId !== requestRef.current) return;
      setState({
        schemaSource: null,
        loading: false,
        error: null,
        siblingCandidates,
      });
    })().catch((error) => {
      if (requestId !== requestRef.current) return;
      setState({
        schemaSource: null,
        loading: false,
        error: error instanceof Error ? error.message : String(error || 'Could not load JSON Schema.'),
        siblingCandidates,
      });
    });

    return () => {
      requestRef.current += 1;
    };
  }, [explicitSchemaPath, format, readTextFile, siblingCandidates]);

  return state;
}

export function jsonSchemaSiblingCandidates(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/');
  const slashIndex = normalized.lastIndexOf('/');
  const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : '';
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf('.');
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const candidates = [
    `${directory}${stem}.schema.json`,
    `${directory}${fileName}.schema.json`,
    `${directory}schema.json`,
  ];
  return filePath.includes('\\') ? candidates.map((candidate) => candidate.replace(/\//g, '\\')) : candidates;
}
