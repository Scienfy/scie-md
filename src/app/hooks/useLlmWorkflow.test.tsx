import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeneratedSiblingArtifact } from '../../services/fileService';
import type { ManuscriptReadiness } from '../../markdown/manuscriptReadiness';
import { useLlmWorkflow } from './useLlmWorkflow';

vi.mock('../../services/fileService', () => ({
  createGeneratedSiblingArtifact: vi.fn(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useLlmWorkflow', () => {
  let container: HTMLDivElement;
  let root: Root;
  let controls: ReturnType<typeof useLlmWorkflow> | null;
  let pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  let closeLlmMenu: () => void;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    controls = null;
    pushToast = vi.fn();
    closeLlmMenu = vi.fn();
    vi.mocked(createGeneratedSiblingArtifact).mockReset();
    vi.mocked(createGeneratedSiblingArtifact)
      .mockResolvedValueOnce({ path: 'C:\\docs\\ScieMD_LLM_skill.md', metadata: metadata() })
      .mockResolvedValueOnce({ path: 'C:\\docs\\SCIENFY_SUBMISSION_READINESS.md', metadata: metadata() });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('generates saved-document artifacts through the native allowlisted sibling command', async () => {
    renderWorkflow('C:\\docs\\paper.md');

    await act(async () => {
      await controls?.generateScieMDLlmSkill();
      await controls?.generateSubmissionReadiness();
    });

    expect(createGeneratedSiblingArtifact).toHaveBeenNthCalledWith(
      1,
      'C:\\docs\\paper.md',
      'llm-skill',
      expect.stringContaining('# ScieMD LLM Skill'),
      expect.objectContaining({ lineEnding: 'lf' }),
    );
    expect(createGeneratedSiblingArtifact).toHaveBeenNthCalledWith(
      2,
      'C:\\docs\\paper.md',
      'submission-readiness',
      expect.stringContaining('Scienfy Submission Readiness Report'),
      expect.objectContaining({ lineEnding: 'lf' }),
    );
    expect(pushToast).toHaveBeenCalledWith('ScieMD LLM skill generated: ScieMD_LLM_skill.md', 'success');
    expect(pushToast).toHaveBeenCalledWith('Submission readiness report generated: SCIENFY_SUBMISSION_READINESS.md', 'success');
  });

  function renderWorkflow(filePath: string | null) {
    act(() => {
      root.render(
        <Harness
          filePath={filePath}
          manuscriptReadiness={readiness()}
          closeLlmMenu={closeLlmMenu}
          pushToast={pushToast}
          onControls={(nextControls) => {
            controls = nextControls;
          }}
        />,
      );
    });
  }
});

function Harness({
  filePath,
  manuscriptReadiness,
  closeLlmMenu,
  pushToast,
  onControls,
}: {
  filePath: string | null;
  manuscriptReadiness: ManuscriptReadiness;
  closeLlmMenu: () => void;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  onControls: (controls: ReturnType<typeof useLlmWorkflow>) => void;
}) {
  const controls = useLlmWorkflow({
    filePath,
    manuscriptReadiness,
    closeLlmMenu,
    pushToast,
  });
  onControls(controls);
  return null;
}

function readiness(): ManuscriptReadiness {
  return {
    score: 100,
    status: 'ready',
    summary: 'Ready for review.',
    items: [],
    counts: {
      headings: 5,
      citations: 2,
      labels: 2,
      figures: 1,
      tables: 1,
      missingImages: 0,
      unresolvedCitations: 0,
      unresolvedReferences: 0,
      missingVariables: 0,
    },
  };
}

function metadata() {
  return {
    lineEnding: 'lf' as const,
    encoding: 'utf8' as const,
    hasBom: false,
    hasMixedLineEndings: false,
    lastKnownMtimeMs: 1,
    lastKnownSizeBytes: 2,
    contentHash: null,
    cloudState: 'local' as const,
  };
}
