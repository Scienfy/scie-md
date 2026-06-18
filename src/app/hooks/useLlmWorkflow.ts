import { useCallback } from 'react';
import { DEFAULT_METADATA, basename } from '../documentState';
import { statFile, writeTextFileCreateNew } from '../../services/fileService';
import { createScieMDLlmSkill } from '../../markdown/llm';
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
      const targetPath = await nextAvailableSiblingPath(skillPathForDocument(filePath));
      await writeTextFileCreateNew(targetPath, skill, DEFAULT_METADATA);
      pushToast(`ScieMD LLM skill generated: ${fileNameFromPath(targetPath)}`, 'success');
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
      await writeTextFileCreateNew(await nextAvailableSiblingPath(submissionReportPathForDocument(filePath)), report, DEFAULT_METADATA);
      pushToast('Submission readiness report generated', 'success');
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

function submissionReportPathForDocument(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const directory = path.replace(/[/\\][^/\\]*$/, '');
  return `${directory}${separator}SCIENFY_SUBMISSION_READINESS.md`;
}

function skillPathForDocument(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const directory = path.replace(/[/\\][^/\\]*$/, '');
  return `${directory}${separator}ScieMD_LLM_skill.md`;
}

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

async function nextAvailableSiblingPath(path: string): Promise<string> {
  if (!(await pathExists(path))) return path;
  const separator = path.includes('\\') ? '\\' : '/';
  const directory = path.replace(/[/\\][^/\\]*$/, '');
  const fileName = path.slice(directory.length + 1);
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : '';
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${directory}${separator}${stem}-${index}${extension}`;
    if (!(await pathExists(candidate))) return candidate;
  }
  return `${directory}${separator}${stem}-${Date.now()}${extension}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await statFile(path, { contentHash: false });
    return true;
  } catch {
    return false;
  }
}
