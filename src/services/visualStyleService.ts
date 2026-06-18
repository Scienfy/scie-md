export const VISUAL_STYLE_OPTIONS = [
  {
    id: 'scientific-draft',
    label: 'Scientific Draft',
    shortLabel: 'Scientific',
    detail: 'Balanced serif writing surface for papers, reports, and research notes.',
  },
  {
    id: 'journal-manuscript',
    label: 'Journal Manuscript',
    shortLabel: 'Journal',
    detail: 'Narrower manuscript rhythm, restrained headings, and publication-like tables.',
  },
  {
    id: 'lab-notebook',
    label: 'Lab Notebook',
    shortLabel: 'Lab',
    detail: 'Tighter spacing, scan-friendly headings, and compact tables for daily records.',
  },
  {
    id: 'technical-code',
    label: 'Technical Code',
    shortLabel: 'Code',
    detail: 'Wide, sans-led technical writing with dense code blocks and tables.',
  },
  {
    id: 'codex',
    label: 'Codex',
    shortLabel: 'Codex',
    detail: 'Full-width AI/code-document reader with dense sans typography and light table rules.',
  },
  {
    id: 'scienfy',
    label: 'Scienfy',
    shortLabel: 'Scienfy',
    detail: 'Modern Scienfy house style with calm sans typography, faint dotted paper texture, and compact scientific blocks.',
  },
  {
    id: 'science',
    label: 'Science',
    shortLabel: 'Science',
    detail: 'Science-inspired editorial article view with assertive red accents, compact news-like rhythm, and grey summary panels.',
  },
  {
    id: 'nature',
    label: 'Nature',
    shortLabel: 'Nature',
    detail: 'Nature-inspired research view with restrained serif hierarchy, blue scholarly links, and precise rule-based sections.',
  },
  {
    id: 'claude',
    label: 'Claude',
    shortLabel: 'Claude',
    detail: 'Claude desktop-inspired warm-dark reading surface with coral accents, comfortable line height, and subtle warm-grey rhythm.',
  },
] as const;

export type VisualStyleId = (typeof VISUAL_STYLE_OPTIONS)[number]['id'];

const VISUAL_STYLE_ALIASES: Record<string, VisualStyleId> = {
  amin: 'scienfy',
  'amin-style': 'scienfy',
  'research-statement': 'scienfy',
  'scie-sans': 'scienfy',
  'scie-sans-compact': 'scienfy',
};

export function isVisualStyleId(value: unknown): value is VisualStyleId {
  return VISUAL_STYLE_OPTIONS.some((style) => style.id === value);
}

export function normalizeVisualStyleId(value: unknown): VisualStyleId | null {
  if (isVisualStyleId(value)) return value;
  if (typeof value !== 'string') return null;
  return VISUAL_STYLE_ALIASES[value] ?? null;
}

export function getVisualStyleOption(id: VisualStyleId) {
  return VISUAL_STYLE_OPTIONS.find((style) => style.id === id) ?? VISUAL_STYLE_OPTIONS[0];
}

export function nextVisualStyle(id: VisualStyleId): VisualStyleId {
  const currentIndex = VISUAL_STYLE_OPTIONS.findIndex((style) => style.id === id);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % VISUAL_STYLE_OPTIONS.length;
  return VISUAL_STYLE_OPTIONS[nextIndex].id;
}
