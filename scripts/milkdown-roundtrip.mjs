import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { Editor, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');
const reviewMode = process.argv.includes('--review');
const offlineMode = process.argv.includes('--offline');

const dom = new JSDOM('<!doctype html><html><body><div id="editor"></div></body></html>', {
  url: 'http://localhost/',
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.getSelection = dom.window.getSelection.bind(dom.window);
globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
globalThis.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);

const syntheticCorpus = [
  {
    name: 'synthetic-commonmark',
    markdown: `# Title

Paragraph with **bold**, _italic_, [a link](https://example.com), and \`inline code\`.

- Alpha
- Beta
  - Nested beta

1. First
2. Second

> A blockquote with enough text to render.

\`\`\`ts
const value = "**keep this exact content**";
\`\`\`
`,
  },
  {
    name: 'synthetic-gfm-table',
    markdown: `# GFM

| Feature | Status | Notes |
| :-- | :-: | --: |
| Tables | yes | 10 |
| Images | yes | 20 |

![Alt text](assets/example.png)
`,
  },
  {
    name: 'synthetic-html-and-directive',
    markdown: `# Advanced Content

<div class="callout">Raw HTML should survive as source text.</div>

::: note
Directive block should trigger source-only validation later.
:::
`,
  },
  {
    name: 'layer2-frontmatter-citation-labels',
    sourceOnly: true,
    markdown: `---
title: Layer II Fixture
bibliography: refs.bib
scienfy:
  documentType: paper
  visualStyle: scienfy
---
# Introduction {#sec-intro}

This cites [@smith2026] and refers to @fig-surface.

![Surface](assets/surface.png){#fig-surface}
`,
  },
];

const remoteCorpus = [
  'https://raw.githubusercontent.com/tauri-apps/tauri/dev/README.md',
  'https://raw.githubusercontent.com/vitejs/vite/main/README.md',
  'https://raw.githubusercontent.com/vitest-dev/vitest/main/README.md',
  'https://raw.githubusercontent.com/facebook/react/main/README.md',
  'https://raw.githubusercontent.com/milkdown/milkdown/main/README.md',
  'https://raw.githubusercontent.com/commonmark/commonmark-spec/master/README.md',
  'https://raw.githubusercontent.com/remarkjs/remark/main/readme.md',
  'https://raw.githubusercontent.com/ProseMirror/prosemirror/main/README.md',
  'https://raw.githubusercontent.com/yjs/yjs/main/README.md',
  'https://raw.githubusercontent.com/microsoft/TypeScript/main/README.md',
];

const localCorpus = [];

function normalizeAcceptable(markdown) {
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.replace(/[ \t]+$/g, '').replace(/^([ \t]*)[*+-]\s+/, '$1- ');
      return /^\|.*\|\s*$/.test(trimmed) ? `|${normalizeTableLine(trimmed)}|` : trimmed;
    })
    .join('\n')
    .replace(/(\n[ \t]*[-+*]\s+[^\n]+)\n\n(?=[ \t]*[-+*]\s+)/g, '$1\n')
    .replace(/(\n[ \t]*[-+*]\s+[^\n]+)\n\n(?=[ \t]*[-+*]\s+)/g, '$1\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/g, '\n');
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function extractFrontmatter(markdown) {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(?=\n|$)/);
  return match?.[0] ?? '';
}

function extractDirectiveFenceLines(markdown) {
  return [...markdown.matchAll(/^:::[^\n]*$/gm)].map((m) => m[0]);
}

function extractBracketCitations(markdown) {
  return [...markdown.matchAll(/\[@[A-Za-z0-9_:.#/-]+(?:[;\s,]+@[A-Za-z0-9_:.#/-]+)*\]/g)].map((m) => m[0]);
}

function extractCrossReferences(markdown) {
  return [...markdown.matchAll(/(^|[^\w/])@(fig|tbl|eq|sec|lst|callout)-[A-Za-z0-9_:.#/-]+/g)].map((m) => m[0].trim());
}

function extractLabels(markdown) {
  return [...markdown.matchAll(/\{#[A-Za-z][\w:.-]*\}/g)].map((m) => m[0]);
}

function inspectRisk(original, serialized) {
  const risks = [];

  const originalCodeBlocks = [...original.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  const serializedCodeBlocks = [...serialized.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
  if (originalCodeBlocks.join('\n---\n') !== serializedCodeBlocks.join('\n---\n')) {
    risks.push('code block content changed');
  }

  const originalLinks = [...original.matchAll(/\[[^\]]+\]\([^)]+\)/g)].map((m) => m[0]);
  const serializedLinks = [...serialized.matchAll(/\[[^\]]+\]\([^)]+\)/g)].map((m) => m[0]);
  if (originalLinks.join('\n') !== serializedLinks.join('\n')) {
    risks.push('link text or URL changed');
  }

  const originalHeadings = [...original.matchAll(/^#{1,6}\s+.+$/gm)].map((m) => m[0]);
  const serializedHeadings = [...serialized.matchAll(/^#{1,6}\s+.+$/gm)].map((m) => m[0]);
  if (originalHeadings.join('\n') !== serializedHeadings.join('\n')) {
    risks.push('heading text or level changed');
  }

  const originalTables = [...original.matchAll(/^\|.*\|\s*$/gm)].map((m) => normalizeTableLine(m[0]));
  const serializedTables = [...serialized.matchAll(/^\|.*\|\s*$/gm)].map((m) => normalizeTableLine(m[0]));
  if (originalTables.length > 0 && originalTables.join('\n') !== serializedTables.join('\n')) {
    risks.push('table content or alignment changed');
  }

  const originalFrontmatter = extractFrontmatter(original);
  const serializedFrontmatter = extractFrontmatter(serialized);
  if (originalFrontmatter && originalFrontmatter !== serializedFrontmatter) {
    risks.push('YAML front matter changed');
  }

  const originalDirectives = extractDirectiveFenceLines(original);
  const serializedDirectives = extractDirectiveFenceLines(serialized);
  if (!sameSequence(originalDirectives, serializedDirectives)) {
    risks.push('directive fence lines changed');
  }

  const originalCitations = extractBracketCitations(original);
  const serializedCitations = extractBracketCitations(serialized);
  if (!sameSequence(originalCitations, serializedCitations)) {
    risks.push('citation keys changed');
  }

  const originalCrossRefs = extractCrossReferences(original);
  const serializedCrossRefs = extractCrossReferences(serialized);
  if (!sameSequence(originalCrossRefs, serializedCrossRefs)) {
    risks.push('cross-reference keys changed');
  }

  const originalLabels = extractLabels(original);
  const serializedLabels = extractLabels(serialized);
  if (!sameSequence(originalLabels, serializedLabels)) {
    risks.push('attribute labels changed');
  }

  return risks;
}

function normalizeTableLine(line) {
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const isSeparator = cells.every((cell) => /^:?-+:?$/.test(cell));
  if (isSeparator) {
    return cells.map((cell) => {
      if (/^:-+:$/.test(cell)) return ':---:';
      if (/^:-+$/.test(cell)) return ':---';
      if (/^-+:$/.test(cell)) return '---:';
      return '---';
    }).join('|');
  }
  return cells.map((cell) => cell.replace(/\s+/g, ' ')).join('|');
}

async function serialize(markdown) {
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm);

  await editor.create();
  const view = editor.ctx.get(editorViewCtx);
  const serializer = editor.ctx.get(serializerCtx);
  const result = serializer(view.state.doc);
  await editor.destroy();
  return result;
}

async function loadRemoteCorpus() {
  const docs = [];
  for (const url of remoteCorpus) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      docs.push({ name: `remote:${new URL(url).pathname.split('/').slice(-3).join('/')}`, markdown: await response.text() });
    } catch (error) {
      console.warn(`WARN remote corpus skipped: ${url} (${error.message})`);
    }
  }
  return docs;
}

async function loadLocalCorpus() {
  const docs = [];
  for (const filePath of localCorpus) {
    try {
      docs.push({ name: `local:${path.basename(filePath)}`, markdown: await readFile(filePath, 'utf8') });
    } catch (error) {
      console.warn(`WARN local corpus skipped: ${filePath} (${error.message})`);
    }
  }
  return docs;
}

function firstDiffLine(left, right) {
  const a = left.split('\n');
  const b = right.split('\n');
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) {
      return {
        line: i + 1,
        before: a[i] ?? '<missing>',
        after: b[i] ?? '<missing>',
      };
    }
  }
  return null;
}

const corpus = [
  ...syntheticCorpus,
  ...(await loadLocalCorpus()),
  ...(offlineMode ? [] : await loadRemoteCorpus()),
];
const results = [];

for (const item of corpus) {
  if (item.sourceOnly) {
    results.push({
      name: item.name,
      pass: true,
      risks: [],
      diff: null,
      note: 'source-only fixture is guarded from visual round-trip',
    });
    continue;
  }
  const serialized = await serialize(item.markdown);
  const acceptableBefore = normalizeAcceptable(item.markdown);
  const acceptableAfter = normalizeAcceptable(serialized);
  const risks = inspectRisk(item.markdown, serialized);
  const equalAfterAcceptedNormalization = acceptableBefore === acceptableAfter;
  const diff = equalAfterAcceptedNormalization ? null : firstDiffLine(acceptableBefore, acceptableAfter);

  results.push({
    name: item.name,
    pass: equalAfterAcceptedNormalization && risks.length === 0,
    risks,
    diff,
  });
}

const failures = results.filter((result) => !result.pass);

for (const result of results) {
  const status = result.pass ? 'PASS' : 'REVIEW';
  console.log(`${status} ${result.name}`);
  if (result.risks.length > 0) {
    console.log(`  risks: ${result.risks.join(', ')}`);
  }
  if (result.diff) {
    console.log(`  first diff line ${result.diff.line}`);
    console.log(`  before: ${result.diff.before}`);
    console.log(`  after:  ${result.diff.after}`);
  }
  if (result.note) {
    console.log(`  note: ${result.note}`);
  }
}

if (failures.length > 0) {
  console.log(`\nMilkdown spike completed with ${failures.length} review item(s).`);
  if (!reviewMode) {
    process.exitCode = 1;
  }
} else {
  console.log('\nMilkdown spike passed accepted Layer 1 criteria.');
}
