import { useEffect, useMemo, useState } from 'react';
import type { BibtexEntry, BibtexEntryDraft } from '@sciemd/core';
import { fetchCrossrefCitationDraft } from '../domain/citations/crossref';
import { ModalShell } from './ModalShell';
import { DialogActions } from './DialogActions';

type CitationMode = 'library' | 'new' | 'edit';
type CitationKind = 'paper' | 'website' | 'doi';

interface CitationDialogProps {
  open: boolean;
  documentPath: string | null;
  entries: BibtexEntry[];
  bibliographyFiles: string[];
  loading: boolean;
  onClose: () => void;
  onInsert: (key: string) => void;
  onSaveEntry: (draft: BibtexEntryDraft, originalKey: string | null) => Promise<void>;
  onDeleteEntry: (key: string) => Promise<void>;
  onReloadBibliography: () => void;
  initialEditKey?: string | null;
}

interface CitationFormState {
  kind: CitationKind;
  entryType: string;
  key: string;
  title: string;
  author: string;
  year: string;
  journal: string;
  publisher: string;
  doi: string;
  url: string;
  note: string;
  extraFields: Record<string, string>;
}

const emptyForm: CitationFormState = {
  kind: 'paper',
  entryType: 'article',
  key: '',
  title: '',
  author: '',
  year: '',
  journal: '',
  publisher: '',
  doi: '',
  url: '',
  note: '',
  extraFields: {},
};

export function CitationDialog({
  open,
  documentPath,
  entries,
  bibliographyFiles,
  loading,
  onClose,
  onInsert,
  onSaveEntry,
  onDeleteEntry,
  onReloadBibliography,
  initialEditKey = null,
}: CitationDialogProps) {
  const [mode, setMode] = useState<CitationMode>('library');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<CitationFormState>(emptyForm);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [doiLookupLoading, setDoiLookupLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const initialEntry = initialEditKey ? entries.find((entry) => entry.key === initialEditKey) : undefined;
    if (initialEntry) {
      setMode('edit');
      setQuery(initialEditKey ?? '');
      setForm(formFromEntry(initialEntry));
      setEditingKey(initialEntry.key);
      setError('');
      setSaving(false);
      setDoiLookupLoading(false);
      return;
    }
    if (initialEditKey) {
      setMode('new');
      setQuery(initialEditKey);
      setForm({ ...emptyForm, key: initialEditKey, kind: 'paper', entryType: 'article' });
      setEditingKey(null);
      setError(`No loaded bibliography entry matched @${initialEditKey}. Create it here or reload the .bib file.`);
      setSaving(false);
      setDoiLookupLoading(false);
      return;
    }
    setMode('library');
    setQuery('');
    setForm(emptyForm);
    setEditingKey(null);
    setError('');
    setSaving(false);
    setDoiLookupLoading(false);
  }, [entries, initialEditKey, open]);

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...entries].sort((a, b) => citationYear(b).localeCompare(citationYear(a)) || a.key.localeCompare(b.key));
    if (!normalized) return sorted;
    return sorted.filter((entry) => (
      `${entry.key} ${entry.type} ${entry.fields.title ?? ''} ${entry.fields.author ?? ''} ${entry.fields.editor ?? ''} ${entry.fields.year ?? ''} ${entry.fields.journal ?? ''} ${entry.fields.url ?? ''} ${entry.fields.doi ?? ''}`
        .toLowerCase()
        .includes(normalized)
    ));
  }, [entries, query]);

  if (!open) return null;

  const startNew = (kind: CitationKind) => {
    setMode('new');
    setEditingKey(null);
    setError('');
    setForm({ ...emptyForm, kind, entryType: kind === 'paper' ? 'article' : 'misc' });
  };
  const startEdit = (entry: BibtexEntry) => {
    setMode('edit');
    setEditingKey(entry.key);
    setError('');
    setForm(formFromEntry(entry));
  };
  const save = async (insertAfterSave: boolean) => {
    const draft = formToDraft(form);
    const validationError = validateCitationDraft(form, draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSaveEntry(draft, editingKey);
      if (insertAfterSave) onInsert(draft.key);
      setMode('library');
      setQuery(draft.key);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save citation.');
    } finally {
      setSaving(false);
    }
  };
  const deleteEntry = async () => {
    if (!editingKey) return;
    setSaving(true);
    setError('');
    try {
      await onDeleteEntry(editingKey);
      setMode('library');
      setQuery('');
      setEditingKey(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete citation.');
    } finally {
      setSaving(false);
    }
  };
  const lookupDoi = async () => {
    if (!form.doi.trim()) {
      setError('Enter a DOI before looking it up.');
      return;
    }
    setDoiLookupLoading(true);
    setError('');
    try {
      const draft = await fetchCrossrefCitationDraft(form.doi);
      setForm((current) => {
        const next: CitationFormState = {
          ...current,
          kind: draft.title ? 'paper' : current.kind,
          entryType: draft.type || current.entryType,
          title: draft.title ?? current.title,
          author: draft.author ?? current.author,
          year: draft.year ?? current.year,
          journal: draft.journal ?? current.journal,
          publisher: draft.publisher ?? current.publisher,
          doi: draft.doi ?? current.doi,
          url: draft.url ?? current.url,
          extraFields: current.extraFields,
        };
        return { ...next, key: current.key || createSuggestedKey(next) };
      });
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Could not look up DOI metadata.');
    } finally {
      setDoiLookupLoading(false);
    }
  };

  return (
    <ModalShell open={open} titleId="citation-dialog-title" className="citation-dialog" onCancel={onClose}>
        <header className="citation-dialog-header">
          <div>
            <h2 id="citation-dialog-title">Insert citation</h2>
            <p>
              {bibliographyFiles.length > 0
                ? `Using ${bibliographyFiles.join(', ')}`
                : documentPath
                  ? 'No bibliography file yet. Creating a citation will add references.bib next to this document.'
                  : 'Save this document first. Creating a citation will then add references.bib next to it.'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close citation dialog">x</button>
        </header>

        <div className="citation-dialog-tabs" role="group" aria-label="Citation actions">
          <button type="button" className={mode === 'library' ? 'selected' : ''} aria-pressed={mode === 'library'} onClick={() => setMode('library')}>Library</button>
          <button type="button" className={mode === 'new' && form.kind === 'paper' ? 'selected' : ''} aria-pressed={mode === 'new' && form.kind === 'paper'} onClick={() => startNew('paper')}>New paper</button>
          <button type="button" className={mode === 'new' && form.kind === 'website' ? 'selected' : ''} aria-pressed={mode === 'new' && form.kind === 'website'} onClick={() => startNew('website')}>New website</button>
          <button type="button" className={mode === 'new' && form.kind === 'doi' ? 'selected' : ''} aria-pressed={mode === 'new' && form.kind === 'doi'} onClick={() => startNew('doi')}>DOI only</button>
        </div>

        {mode === 'library' ? (
          <div className="citation-library">
            <div className="citation-search-row">
              <input
                autoFocus
                aria-label="Search citations"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title, author, year, DOI, URL, or key"
              />
              <button type="button" disabled={loading} onClick={onReloadBibliography}>{loading ? 'Reloading...' : 'Reload .bib'}</button>
            </div>
            {filteredEntries.length === 0 ? (
              <div className="citation-empty">
                <strong>{entries.length === 0 ? 'No BibTeX entries loaded.' : 'No matching citation.'}</strong>
                <span>Create a new paper, website, or DOI-only entry above.</span>
              </div>
            ) : (
              <div className="citation-entry-list">
                {filteredEntries.map((entry) => (
                  <article key={entry.key} className="citation-entry-card">
                    <div>
                      <strong>{cleanField(entry.fields.title) || entry.key}</strong>
                      <span>{citationByline(entry)}</span>
                      <code>@{entry.key}</code>
                    </div>
                    <div className="citation-entry-actions">
                      {citationLink(entry) && <a href={citationLink(entry) ?? undefined} target="_blank" rel="noreferrer">Open</a>}
                      <button type="button" onClick={() => startEdit(entry)}>Edit</button>
                      <button type="button" className="primary" onClick={() => onInsert(entry.key)}>Insert</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <CitationForm
            mode={mode}
            form={form}
            editingKey={editingKey}
            requiresDocumentSave={!documentPath}
            saving={saving}
            error={error}
            onChange={setForm}
            onCancel={() => setMode('library')}
            onSave={() => void save(false)}
            onSaveAndInsert={() => void save(true)}
            onDelete={mode === 'edit' ? () => void deleteEntry() : undefined}
            onLookupDoi={() => void lookupDoi()}
            doiLookupLoading={doiLookupLoading}
          />
        )}
    </ModalShell>
  );
}

function CitationForm({ mode, form, editingKey, requiresDocumentSave, saving, error, doiLookupLoading, onChange, onCancel, onSave, onSaveAndInsert, onDelete, onLookupDoi }: {
  mode: CitationMode;
  form: CitationFormState;
  editingKey: string | null;
  requiresDocumentSave: boolean;
  saving: boolean;
  error: string;
  doiLookupLoading: boolean;
  onChange: (next: CitationFormState) => void;
  onCancel: () => void;
  onSave: () => void;
  onSaveAndInsert: () => void;
  onDelete?: () => void;
  onLookupDoi: () => void;
}) {
  const update = (patch: Partial<CitationFormState>) => onChange({ ...form, ...patch });
  const generatedKey = createSuggestedKey(form);
  const required = form.kind === 'doi'
    ? 'A DOI-only entry stores only the citation key and DOI.'
    : form.kind === 'website'
      ? 'A website entry stores only title, citation key, and website URL.'
      : 'A paper entry stores title, authors, year, journal or venue, and optional DOI/URL.';

  return (
    <div className="citation-form">
      <div className="citation-form-note">
        <strong>{mode === 'edit' ? `Editing @${editingKey}` : `New ${form.kind === 'doi' ? 'DOI-only' : form.kind} citation`}</strong>
        <span>{required}</span>
      </div>
      {requiresDocumentSave && (
        <div className="citation-save-warning">
          This document has not been saved yet. When you save this citation, ScieMD will first ask where to save the Markdown file, then create <code>references.bib</code> beside it.
        </div>
      )}
      <label>
        Citation key
        <div className="citation-key-row">
          <input value={form.key} onChange={(event) => update({ key: event.target.value })} placeholder={generatedKey || 'smith2026'} />
          {mode === 'new' && <button type="button" onClick={() => update({ key: generatedKey })} disabled={!generatedKey}>Use suggested</button>}
        </div>
      </label>
      <label>
        Title
        <input value={form.title} onChange={(event) => update({ title: event.target.value })} placeholder={form.kind === 'paper' ? 'Article title' : 'Page title'} />
      </label>
      {form.kind === 'paper' && (
        <>
          <label>
            Authors
            <input value={form.author} onChange={(event) => update({ author: event.target.value })} placeholder="Jane Smith and Alex Doe" />
          </label>
          <div className="citation-form-grid">
            <label>
              Year
              <input value={form.year} onChange={(event) => update({ year: event.target.value })} placeholder="2026" />
            </label>
            <label>
              Journal / venue
              <input value={form.journal} onChange={(event) => update({ journal: event.target.value })} placeholder="Journal name" />
            </label>
          </div>
          <div className="citation-form-grid">
            <label>
              DOI
              <div className="citation-doi-row">
                <input value={form.doi} onChange={(event) => update({ doi: event.target.value })} placeholder="10.1234/example" />
                <button type="button" disabled={doiLookupLoading || !form.doi.trim()} onClick={onLookupDoi}>{doiLookupLoading ? 'Looking up...' : 'Lookup DOI'}</button>
              </div>
            </label>
            <label>
              URL
              <input value={form.url} onChange={(event) => update({ url: event.target.value })} placeholder="https://..." />
            </label>
          </div>
        </>
      )}
      {form.kind === 'website' && (
        <label>
          Website
          <input value={form.url} onChange={(event) => update({ url: event.target.value })} placeholder="https://example.org/page" />
        </label>
      )}
      {form.kind === 'doi' && (
        <>
          <label>
            DOI
            <div className="citation-doi-row">
              <input value={form.doi} onChange={(event) => update({ doi: event.target.value })} placeholder="10.1234/example" />
              <button type="button" disabled={doiLookupLoading || !form.doi.trim()} onClick={onLookupDoi}>{doiLookupLoading ? 'Looking up...' : 'Lookup DOI'}</button>
            </div>
          </label>
        </>
      )}
      {mode === 'edit' && Object.keys(form.extraFields).length > 0 && (
        <p className="citation-form-preserved">
          {Object.keys(form.extraFields).length} additional BibTeX field{Object.keys(form.extraFields).length === 1 ? '' : 's'} preserved.
        </p>
      )}
      {error && <p className="citation-form-error">{error}</p>}
      <DialogActions>
        <button type="button" onClick={onCancel}>Cancel</button>
        {onDelete && <button type="button" className="danger" disabled={saving} onClick={onDelete}>Delete citation</button>}
        <button type="button" disabled={saving} onClick={onSave}>{saving ? 'Saving...' : requiresDocumentSave ? 'Save document + citation' : 'Save'}</button>
        <button type="button" className="primary" disabled={saving} onClick={onSaveAndInsert}>{saving ? 'Saving...' : requiresDocumentSave ? 'Save document + insert' : 'Save and insert'}</button>
      </DialogActions>
    </div>
  );
}

function formFromEntry(entry: BibtexEntry): CitationFormState {
  const type = entry.type.toLowerCase();
  const kind: CitationKind = type === 'article' ? 'paper' : entry.fields.doi && !entry.fields.title ? 'doi' : 'website';
  return {
    kind,
    entryType: entry.type || (kind === 'paper' ? 'article' : 'misc'),
    key: entry.key,
    title: cleanField(entry.fields.title),
    author: cleanField(entry.fields.author || entry.fields.editor),
    year: cleanField(entry.fields.year),
    journal: cleanField(entry.fields.journal || entry.fields.booktitle),
    publisher: cleanField(entry.fields.publisher || entry.fields.organization),
    doi: cleanField(entry.fields.doi),
    url: cleanField(entry.fields.url),
    note: cleanField(entry.fields.note),
    extraFields: extraBibtexFields(entry.fields, kind),
  };
}

function formToDraft(form: CitationFormState): BibtexEntryDraft {
  const base = {
    type: form.entryType || (form.kind === 'paper' ? 'article' : 'misc'),
    key: normalizeCitationKey(form.key),
    extraFields: form.extraFields,
  };
  if (form.kind === 'website') {
    return {
      ...base,
      title: form.title.trim() || undefined,
      url: normalizeUrl(form.url),
    };
  }
  if (form.kind === 'doi') {
    return {
      ...base,
      doi: form.doi.trim() || undefined,
    };
  }
  return {
    ...base,
    title: form.title.trim() || undefined,
    author: form.author.trim() || undefined,
    year: form.year.trim() || undefined,
    journal: form.journal.trim() || undefined,
    doi: form.doi.trim() || undefined,
    url: normalizeUrl(form.url),
  };
}

function citationByline(entry: BibtexEntry): string {
  const authors = cleanField(entry.fields.author || entry.fields.editor || 'Unknown authors');
  const year = citationYear(entry) || 'n.d.';
  const venue = cleanField(entry.fields.journal || entry.fields.booktitle || entry.fields.publisher || entry.fields.organization || '');
  return [authors, year, venue].filter(Boolean).join(' - ');
}

function citationYear(entry: BibtexEntry): string {
  return cleanField(entry.fields.year || '');
}

function citationLink(entry: BibtexEntry): string | null {
  const doi = cleanField(entry.fields.doi || '');
  if (doi) return doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
  const url = cleanField(entry.fields.url || '');
  return /^https?:\/\//i.test(url) ? url : null;
}

function createSuggestedKey(form: CitationFormState): string {
  const authorSeed = form.author || hostnameFromUrl(form.url) || form.title || form.doi || form.url;
  const author = authorSeed
    .split(/\s+and\s+|,|\s+/i)
    .find(Boolean)
    ?.replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase() || 'source';
  const year = form.year.match(/\d{4}/)?.[0] ?? new Date().getFullYear().toString();
  const titleWord = form.title
    .split(/\s+/)
    .find((word) => word.length > 4)
    ?.replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase() || '';
  return `${author}${year}${titleWord}`.slice(0, 48);
}

function normalizeCitationKey(value: string): string {
  return value.trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_:.#$%&+\-?<>~/]/g, '');
}

function validateCitationDraft(form: CitationFormState, draft: BibtexEntryDraft): string | null {
  if (!draft.key) return 'Citation key is required.';
  if (form.kind === 'website') {
    if (!draft.title) return 'Website title is required.';
    if (!draft.url) return 'Website URL is required.';
    if (!/^https?:\/\//i.test(draft.url)) return 'Website URL should start with http:// or https://.';
  }
  if (form.kind === 'doi' && !draft.doi) return 'DOI is required.';
  if (form.kind === 'paper' && !draft.title) return 'Paper title is required.';
  return null;
}

function normalizeUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function hostnameFromUrl(value: string): string {
  try {
    const normalized = normalizeUrl(value);
    if (!normalized) return '';
    return new URL(normalized).hostname.replace(/^www\./i, '').split('.')[0] ?? '';
  } catch {
    return '';
  }
}

function extraBibtexFields(fields: Record<string, string>, kind: CitationKind): Record<string, string> {
  const controlledByKind: Record<CitationKind, string[]> = {
    paper: ['title', 'author', 'editor', 'year', 'journal', 'doi', 'url'],
    website: ['title', 'url'],
    doi: ['doi'],
  };
  const known = new Set(controlledByKind[kind]);
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !known.has(key.toLowerCase())));
}

function cleanField(value = ''): string {
  return value.replace(/[{}]/g, '').replace(/\\&/g, '&').replace(/\s+/g, ' ').trim();
}
