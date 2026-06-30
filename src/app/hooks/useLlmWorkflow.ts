import { useCallback } from 'react';
import { createScieMDLlmSkill } from '@sciemd/core';
import { DEFAULT_METADATA, basename } from '../documentState';
import { createGeneratedSiblingArtifact } from '../../services/fileService';
import { createSubmissionReadinessReport } from '../../markdown/manuscriptReadiness';
import type { ManuscriptReadiness } from '../../markdown/manuscriptReadiness';

interface LlmWorkflowParams {
  filePath: string | null;
  manuscriptReadiness: ManuscriptReadiness;
  closeLlmMenu: () => void;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function useLlmWorkflow({
  filePath,
  manuscriptReadiness,
  closeLlmMenu,
  pushToast,
}: LlmWorkflowParams) {
  const copyScieMDLlmSkill = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(createScieMDLlmSkill());
      pushToast('ScieMD LLM skill copied', 'success');
      closeLlmMenu();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not copy ScieMD LLM skill.', 'error');
    }
  }, [closeLlmMenu, pushToast]);

  const generateScieMDLlmSkill = useCallback(async () => {
    try {
      const skill = createScieMDLlmSkill();
      if (!filePath) {
        await navigator.clipboard.writeText(skill);
        pushToast('Save the document first to create ScieMD_LLM_skill.md beside it. ScieMD LLM skill copied instead.', 'warning');
        return;
      }
      const artifact = await createGeneratedSiblingArtifact(filePath, 'llm-skill', skill, DEFAULT_METADATA);
      pushToast(`ScieMD LLM skill generated: ${fileNameFromPath(artifact.path)}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not generate ScieMD LLM skill.', 'error');
    }
  }, [filePath, pushToast]);

  const generateSubmissionReadiness = useCallback(async () => {
    try {
      const report = createSubmissionReadinessReport(basename(filePath), manuscriptReadiness);
      if (!filePath) {
        await navigator.clipboard.writeText(report);
        pushToast('Submission readiness report copied', 'success');
        return;
      }
      const artifact = await createGeneratedSiblingArtifact(filePath, 'submission-readiness', report, DEFAULT_METADATA);
      pushToast(`Submission readiness report generated: ${fileNameFromPath(artifact.path)}`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not generate submission readiness report.', 'error');
    }
  }, [filePath, manuscriptReadiness, pushToast]);

  return {
    copyScieMDLlmSkill,
    generateScieMDLlmSkill,
    generateSubmissionReadiness,
  };
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}
