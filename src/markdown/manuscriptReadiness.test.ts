import { describe, expect, it } from 'vitest';
import { parseScienfyDocument } from '@sciemd/core';
import { analyzeMarkdownDocument } from './documentIntelligence';
import {
  assessManuscriptReadiness,
  createSectionRevisionPacket,
  createSubmissionReadinessReport,
} from './manuscriptReadiness';

const manuscript = `---
title: Test Paper
bibliography: refs.bib
---

# Abstract

Short summary [@smith2026].

# Introduction

The background references @fig-1.

# Methods

:::figure {#fig-1}
![Figure](assets/figure.png)

Caption.
:::

# Results

| A | B |
| --- | --- |
| 1 | 2 |

# Discussion

Interpretation.

# Data availability

Data statement.

# Code availability

Code statement.

# Competing interests

None.

# Author contributions

AM wrote the draft.
`;

describe('manuscriptReadiness', () => {
  it('scores a manuscript-style document and reports submission counts', () => {
    const parsed = parseScienfyDocument(manuscript, { bibtex: '@article{smith2026,title={A}}' });
    const readiness = assessManuscriptReadiness(manuscript, parsed, analyzeMarkdownDocument(manuscript), 0);

    expect(readiness.status).toBe('ready');
    expect(readiness.score).toBe(100);
    expect(readiness.counts.citations).toBe(1);
    expect(readiness.counts.figures).toBe(1);
    expect(readiness.counts.tables).toBe(1);
  });

  it('generates a section-focused LLM packet', () => {
    const parsed = parseScienfyDocument(manuscript, { bibtex: '@article{smith2026,title={A}}' });
    const readiness = assessManuscriptReadiness(manuscript, parsed, analyzeMarkdownDocument(manuscript), 0);
    const packet = createSectionRevisionPacket(manuscript, 'paper.md', 12, readiness);

    expect(packet).toContain('Active section: Introduction');
    expect(packet).toContain('Return revised Markdown for this section only');
    expect(packet).toContain('The background references @fig-1.');
    expect(packet).not.toContain('# Methods');
  });

  it('creates a portable submission readiness report', () => {
    const parsed = parseScienfyDocument('# Draft\n\nNo structure.', {});
    const readiness = assessManuscriptReadiness('# Draft\n\nNo structure.', parsed, analyzeMarkdownDocument('# Draft\n\nNo structure.'), 0);
    const report = createSubmissionReadinessReport('draft.md', readiness);

    expect(report).toContain('# Scienfy Submission Readiness Report');
    expect(report).toContain('Core manuscript sections');
    expect(report).toContain('Status: blocked');
  });

  it('honors front matter aliases for non-English manuscript section headings', () => {
    const localized = `---
title: Article localise
scienfy:
  readiness:
    requiredSectionAliases:
      abstract: [Resume]
      introduction: [Introduction generale]
      methods: [Methodes]
      results: [Resultats]
      discussion: [Discussion]
    submissionStatementAliases:
      data-availability: [Disponibilite des donnees]
      code-availability: [Disponibilite du code]
      competing-interests: [Conflits d'interets]
      author-contributions: [Contributions des auteurs]
---

# Resume
# Introduction generale
# Methodes
# Resultats
# Discussion
# Disponibilite des donnees
# Disponibilite du code
# Conflits d'interets
# Contributions des auteurs
`;
    const parsed = parseScienfyDocument(localized);
    const readiness = assessManuscriptReadiness(localized, parsed, analyzeMarkdownDocument(localized), 0);

    expect(readiness.items.find((item) => item.id === 'required-sections')?.severity).toBe('pass');
    expect(readiness.items.find((item) => item.id === 'submission-statements')?.severity).toBe('pass');
  });
});
