import type { BibtexEntryDraft } from '@sciemd/core';

interface CrossrefPerson {
  given?: string;
  family?: string;
  name?: string;
}

interface CrossrefDateParts {
  'date-parts'?: Array<Array<number>>;
}

interface CrossrefWorkMessage {
  DOI?: string;
  URL?: string;
  type?: string;
  title?: string[];
  author?: CrossrefPerson[];
  editor?: CrossrefPerson[];
  publisher?: string;
  'container-title'?: string[];
  'published-print'?: CrossrefDateParts;
  'published-online'?: CrossrefDateParts;
  published?: CrossrefDateParts;
  issued?: CrossrefDateParts;
}

interface CrossrefWorkResponse {
  status?: string;
  message?: CrossrefWorkMessage;
}

export async function fetchCrossrefCitationDraft(
  doi: string,
  fetcher: typeof fetch = fetch,
): Promise<BibtexEntryDraft> {
  const normalizedDoi = normalizeDoiInput(doi);
  if (!normalizedDoi) throw new Error('Enter a DOI before looking it up.');
  const response = await fetcher(`https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'No Crossref record was found for that DOI.' : `Crossref lookup failed (${response.status}).`);
  }
  const payload = await response.json() as CrossrefWorkResponse;
  if (!payload.message) throw new Error('Crossref returned an empty record for that DOI.');
  return crossrefMessageToCitationDraft(payload.message, normalizedDoi);
}

export function crossrefMessageToCitationDraft(message: CrossrefWorkMessage, requestedDoi = ''): BibtexEntryDraft {
  const doi = normalizeDoiInput(message.DOI ?? requestedDoi);
  const authors = message.author?.length ? message.author : message.editor ?? [];
  return {
    type: bibtexTypeForCrossrefType(message.type),
    key: '',
    title: firstText(message.title),
    author: formatCrossrefPeople(authors),
    year: String(firstDateYear(message['published-print']) ?? firstDateYear(message['published-online']) ?? firstDateYear(message.published) ?? firstDateYear(message.issued) ?? ''),
    journal: firstText(message['container-title']) || message.publisher,
    publisher: message.publisher,
    doi: doi || undefined,
    url: message.URL,
  };
}

export function normalizeDoiInput(value: string): string {
  return value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^https?:\/\/doi\.org\//i, '')
    .trim();
}

function bibtexTypeForCrossrefType(type = ''): string {
  switch (type) {
    case 'journal-article':
      return 'article';
    case 'proceedings-article':
      return 'inproceedings';
    case 'book':
    case 'monograph':
      return 'book';
    case 'book-chapter':
      return 'incollection';
    case 'posted-content':
    case 'report':
    default:
      return 'misc';
  }
}

function firstText(values: string[] | undefined): string | undefined {
  return values?.find((value) => value.trim())?.trim();
}

function firstDateYear(date: CrossrefDateParts | undefined): number | undefined {
  const year = date?.['date-parts']?.[0]?.[0];
  return Number.isFinite(year) ? year : undefined;
}

function formatCrossrefPeople(people: CrossrefPerson[]): string | undefined {
  const names = people
    .map((person) => {
      if (person.family || person.given) return [person.given, person.family].filter(Boolean).join(' ');
      return person.name?.trim() ?? '';
    })
    .filter(Boolean);
  return names.length > 0 ? names.join(' and ') : undefined;
}
