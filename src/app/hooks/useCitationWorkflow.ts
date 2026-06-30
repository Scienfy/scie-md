import { useCallback, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { createBackupSnapshot, readTextFile, statFile, writeTextFileAtomic } from '../../services/fileService';
import { countCitationKeyUsages, createBibtexEntrySource, deleteBibtexEntrySource, renameCitationKeyUsages, upsertBibtexEntrySource } from '@sciemd/core';
import type { BibtexEntryDraft } from '@sciemd/core';
import type { ParsedScienfyDocument } from '@sciemd/core';
import { getStringArrayField, parseFrontmatter, serializeFrontmatter } from '@sciemd/core';
import { resolveRelativeMarkdownAsset } from '../../markdown/documentIntelligence';
import { metadataChanged } from '../documentState';
import type { FileMetadata } from '../documentState';

interface CitationWorkflowParams {
  filePath: string | null;
  layerTwoDocument: ParsedScienfyDocument;
  markdownRef: MutableRefObject<string>;
  setMarkdown: Dispatch<SetStateAction<string>>;
  saveCurrent: (options?: { autosave?: boolean; forceSaveAs?: boolean; forceOverwrite?: boolean }) => Promise<string | false>;
  reloadBibliography: () => void;
  pushToast: (text: string, tone?: 'info' | 'success' | 'warning' | 'error') => void;
  confirmText: (state: { title: string; message: string; okLabel: string; cancelLabel: string }) => Promise<boolean>;
}

export function useCitationWorkflow({
  filePath,
  layerTwoDocument,
  markdownRef,
  setMarkdown,
  saveCurrent,
  reloadBibliography,
  pushToast,
  confirmText,
}: CitationWorkflowParams) {
  const [citationDialogOpen, setCitationDialogOpen] = useState(false);

  const reloadBibliographyFromDisk = useCallback(() => {
    if (layerTwoDocument.bibliographyFiles.length === 0) {
      pushToast('No bibliography file is configured in front matter.', 'warning');
      return;
    }
    reloadBibliography();
    pushToast('Reloading bibliography from disk...', 'info');
  }, [layerTwoDocument.bibliographyFiles.length, pushToast, reloadBibliography]);

  const saveCitationEntry = useCallback(async (draft: BibtexEntryDraft, originalKey: string | null) => {
    let documentPath = filePath;
    if (!documentPath) {
      const savedPath = await saveCurrent({ forceSaveAs: true });
      if (typeof savedPath !== 'string') {
        throw new Error('Save canceled. Save the document before creating a bibliography entry.');
      }
      documentPath = savedPath;
    }

    const bibliographyFile = layerTwoDocument.bibliographyFiles[0] ?? 'references.bib';
    const bibliographyPath = resolveRelativeMarkdownAsset(documentPath, bibliographyFile);
    if (!bibliographyPath) {
      throw new Error('Could not resolve the bibliography file path.');
    }

    const normalizedNextKey = draft.key;
    const renamingKey = Boolean(originalKey && normalizedNextKey && originalKey !== normalizedNextKey);
    if (renamingKey && originalKey) {
      const usageCount = countCitationKeyUsages(markdownRef.current, originalKey);
      if (usageCount > 0) {
        const confirmed = await confirmText({
          title: `Rename @${originalKey}?`,
          message: `Update ${usageCount} citation use${usageCount === 1 ? '' : 's'} in this document to @${normalizedNextKey}?`,
          okLabel: 'Rename citations',
          cancelLabel: 'Cancel',
        });
        if (!confirmed) throw new Error('Citation key rename canceled.');
      }
    }

    const nextEntry = createBibtexEntrySource(draft);
    let bibtexForUpsert = '';
    let writeMetadata: FileMetadata | null = null;
    try {
      const response = await readTextFile(bibliographyPath);
      bibtexForUpsert = response.content;
      writeMetadata = response.metadata;
    } catch {
      bibtexForUpsert = '';
      writeMetadata = null;
    }

    const freshMetadata = await statFile(bibliographyPath, { contentHash: true }).catch(() => null);
    if (freshMetadata && (!writeMetadata || metadataChanged(writeMetadata, freshMetadata, 0))) {
      const fresh = await readTextFile(bibliographyPath);
      bibtexForUpsert = fresh.content;
      writeMetadata = fresh.metadata;
      await createBackupSnapshot(bibliographyPath, 'external-bib').catch((error) => {
        console.warn('Could not back up externally changed bibliography.', error);
      });
      pushToast('Bibliography changed on disk. ScieMD merged your citation into the latest .bib file and kept a backup.', 'warning');
    }

    const nextBibtex = upsertBibtexEntrySource(bibtexForUpsert, originalKey, nextEntry);
    await writeTextFileAtomic(bibliographyPath, nextBibtex, writeMetadata, writeMetadata);

    let nextMarkdown = markdownRef.current;
    if (renamingKey && originalKey) {
      nextMarkdown = renameCitationKeyUsages(nextMarkdown, originalKey, normalizedNextKey);
    }
    if (layerTwoDocument.bibliographyFiles.length === 0) {
      nextMarkdown = ensureBibliographyFrontmatter(nextMarkdown, bibliographyFile);
    }
    if (nextMarkdown !== markdownRef.current) {
      markdownRef.current = nextMarkdown;
      setMarkdown(nextMarkdown);
    }

    reloadBibliography();
    pushToast(originalKey ? `Updated @${draft.key} in ${bibliographyFile}.` : `Added @${draft.key} to ${bibliographyFile}.`, 'success');
  }, [confirmText, filePath, layerTwoDocument.bibliographyFiles, markdownRef, pushToast, reloadBibliography, saveCurrent, setMarkdown]);

  const deleteCitationEntry = useCallback(async (key: string) => {
    let documentPath = filePath;
    if (!documentPath) {
      const savedPath = await saveCurrent({ forceSaveAs: true });
      if (typeof savedPath !== 'string') {
        throw new Error('Save canceled. Save the document before editing its bibliography.');
      }
      documentPath = savedPath;
    }
    const bibliographyFile = layerTwoDocument.bibliographyFiles[0] ?? 'references.bib';
    const bibliographyPath = resolveRelativeMarkdownAsset(documentPath, bibliographyFile);
    if (!bibliographyPath) {
      throw new Error('Could not resolve the bibliography file path.');
    }
    const usageCount = countCitationKeyUsages(markdownRef.current, key);
    const confirmed = await confirmText({
      title: `Delete @${key}?`,
      message: usageCount > 0
        ? `This removes @${key} from ${bibliographyFile}. The document still contains ${usageCount} citation use${usageCount === 1 ? '' : 's'}, which will be marked missing until you update them.`
        : `This removes @${key} from ${bibliographyFile}.`,
      okLabel: 'Delete citation',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) throw new Error('Citation deletion canceled.');

    const response = await readTextFile(bibliographyPath);
    let bibtexForDelete = response.content;
    let writeMetadata: FileMetadata | null = response.metadata;
    const freshMetadata = await statFile(bibliographyPath, { contentHash: true }).catch(() => null);
    if (freshMetadata && metadataChanged(writeMetadata, freshMetadata, 0)) {
      const fresh = await readTextFile(bibliographyPath);
      bibtexForDelete = fresh.content;
      writeMetadata = fresh.metadata;
      await createBackupSnapshot(bibliographyPath, 'external-bib').catch((error) => {
        console.warn('Could not back up externally changed bibliography.', error);
      });
      pushToast('Bibliography changed on disk. ScieMD deleted from the latest .bib file and kept a backup.', 'warning');
    }
    const nextBibtex = deleteBibtexEntrySource(bibtexForDelete, key);
    if (nextBibtex === bibtexForDelete) throw new Error(`Could not find @${key} in ${bibliographyFile}.`);
    await writeTextFileAtomic(bibliographyPath, nextBibtex, writeMetadata, writeMetadata);
    reloadBibliography();
    pushToast(`Deleted @${key} from ${bibliographyFile}.`, usageCount > 0 ? 'warning' : 'success');
  }, [confirmText, filePath, layerTwoDocument.bibliographyFiles, markdownRef, pushToast, reloadBibliography, saveCurrent]);

  return {
    citationDialogOpen,
    setCitationDialogOpen,
    reloadBibliographyFromDisk,
    saveCitationEntry,
    deleteCitationEntry,
  };
}

function ensureBibliographyFrontmatter(markdown: string, bibliographyFile: string): string {
  const frontmatter = parseFrontmatter(markdown);
  if (frontmatter.error) {
    throw new Error('Fix the front matter YAML before ScieMD can add a bibliography file.');
  }
  if (getStringArrayField(frontmatter.data, 'bibliography').length > 0) return markdown;
  return serializeFrontmatter(
    { ...frontmatter.data, bibliography: bibliographyFile },
    frontmatter.hasFrontmatter ? frontmatter.body : markdown,
  );
}
