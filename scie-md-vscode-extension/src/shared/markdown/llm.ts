export type LlmPromptMode = 'style-guide' | 'summarize' | 'expand';

import { safeParseScienfyDocument } from '../domain/document/documentModel';
import { describeProtectedAnchors, describeProtectedBlocks, parseProtectedAnchors, parseProtectedBlocks } from './protectedBlocks';
import { parseEditorComments } from './editorComments';
import { parseTargetedInstructions } from './targetedInstructions';
import { extractHeadings } from './outline';
import type { VariableDefinition } from '../domain/variables/variableIndex';

export interface LlmClipboardOptions {
  selection?: string;
  variableDefinitions?: VariableDefinition[];
}

export function createLlmClipboardPayload(
  markdown: string,
  documentName: string,
  mode: LlmPromptMode = 'style-guide',
  options: LlmClipboardOptions = {},
): string {
  const parsed = safeParseScienfyDocument(markdown);
  const headings = extractHeadings(markdown);
  const labels = parsed.references.labels.map((label) => label.id);
  const citations = Array.from(new Set(parsed.citations.usages.map((usage) => usage.key)));
  const protectedBlocks = parseProtectedBlocks(markdown);
  const protectedAnchors = parseProtectedAnchors(markdown);
  const editorComments = parseEditorComments(markdown);
  const llmNotes = editorComments.filter((comment) => comment.audience !== 'human');
  const humanNotes = editorComments.filter((comment) => comment.audience === 'human');
  const targetedInstructions = parseTargetedInstructions(markdown);
  const variableDefinitions = uniqueVariableDefinitions(options.variableDefinitions ?? parsed.variables.definitions);
  const variableSummary = variableDefinitions.map((definition) => (
    `${definition.name} = ${definition.value}${definition.file ? ` (${definition.file})` : ` (${definition.source})`}`
  ));
  const variantSummary = parsed.variantGroups.map((group) => {
    const active = group.items.find((item) => item.id === group.active) ?? group.items[0];
    return `${group.id}: active ${active?.id ?? group.active} of ${group.items.length}`;
  });
  const selectedMarkdown = options.selection?.trim() ?? '';
  const sourceMarkdown = selectedMarkdown || markdown;

  return [
    '# ScieMD LLM Editing Packet',
    '',
    'You are editing a ScieMD document for a scientific or technical author.',
    'The saved file must remain clean Markdown that humans and LLMs can read without ScieMD.',
    '',
    '## Format Contract',
    '- Preserve all content, headings, links, tables, code fences, image references, and relative asset paths.',
    '- Preserve YAML front matter unless the task explicitly asks to change metadata.',
    '- Preserve citation keys such as [@smith2026] and cross-references such as @fig-surface.',
    '- Preserve labels in attributes such as {#fig-surface}.',
    '- Preserve dynamic variable tokens such as `{{reactor_temp}}` exactly. Do not replace them with their evaluated values inside the Markdown.',
    '- Preserve variant groups exactly: `<!-- scie_md:variant:group ... -->`, `<!-- scie_md:variant:item ... -->`, and `<!-- scie_md:variant:end -->` comments are structural version history.',
    '- Treat `<!-- scie_md:lock:start --> ... <!-- scie_md:lock:end -->` sections and `<!-- scie_md:lock target="quote" quote="..." -->` anchored locks as protected. Do not edit locked content unless the task explicitly says to unlock or edit it.',
    '- For quote-anchored locks, notes, and text versions, preserve `quote`, `prefix`, and `suffix` attributes exactly. `prefix` and `suffix` are selector context, not manuscript text.',
    '- Treat `<!-- scie_md:note kind="llm" id="..." target="quote" quote="...": ... -->` comments as author instructions near the relevant text. The `quote` attribute identifies the intended text without wrapping or replacing it.',
    '- Treat legacy `<!-- scie_md:comment audience="llm": ... -->` comments as author instructions near the relevant text.',
    '- Treat `<!-- scie_md:note kind="human" ... -->` comments as review notes for the human author. Preserve them unless the user explicitly asks to remove review notes.',
    '- Treat `<!-- scie_md:instruction target="next-block" prompt="..." -->` comments as surgical edit instructions for the nearest target block.',
    '- If you fully complete a `kind="llm"` note with an `id`, remove only that completed LLM note and add a nearby `kind="human"` note with `source="that-id"` summarizing what you changed for human review.',
    '- If you fully complete a targeted instruction, remove only that completed `scie_md:instruction` comment from the returned Markdown. Keep unresolved instructions.',
    '- Use CommonMark/GFM Markdown, fenced code blocks, and plain `$...$` or `$$...$$` math syntax when math is needed.',
    '- Use ```mermaid fenced blocks for diagrams when a flowchart or process graphic is useful.',
    '- Do not convert the document to HTML, MDX, JSON, or a proprietary app format.',
    '- Return revised Markdown only unless the task asks for commentary.',
    '',
    '## Document Context',
    `Document: ${documentName}`,
    parsed.title ? `Title: ${parsed.title}` : 'Title: unknown',
    parsed.documentType ? `ScieMD document type: ${parsed.documentType}` : 'ScieMD document type: unspecified',
    parsed.visualStyle ? `Visual style: ${parsed.visualStyle}` : 'Visual style: unspecified',
    `Headings: ${headings.length === 0 ? 'none' : headings.map((heading) => `${'#'.repeat(heading.level)} ${heading.text}`).join(' | ')}`,
    `Reference labels: ${labels.length === 0 ? 'none' : labels.join(', ')}`,
    `Citation keys: ${citations.length === 0 ? 'none' : citations.join(', ')}`,
    `Dynamic variables: ${variableSummary.length === 0 ? 'none' : variableSummary.join(' | ')}`,
    `Missing variables: ${parsed.variables.missingVariables.length === 0 ? 'none' : parsed.variables.missingVariables.join(', ')}`,
    `Protected sections: ${protectedBlocks.length === 0 ? 'none' : describeProtectedBlocks(protectedBlocks).join(' | ')}`,
    `Protected quotes: ${protectedAnchors.length === 0 ? 'none' : describeProtectedAnchors(protectedAnchors).join(' | ')}`,
    `Notes to LLM: ${llmNotes.length === 0 ? 'none' : llmNotes.map(describeEditorNoteForPrompt).join(' | ')}`,
    `Notes to Human: ${humanNotes.length === 0 ? 'none' : humanNotes.map(describeEditorNoteForPrompt).join(' | ')}`,
    `Targeted instructions: ${targetedInstructions.length === 0 ? 'none' : targetedInstructions.map((item) => `line ${item.line} -> ${item.target}: ${item.prompt}`).join(' | ')}`,
    `Variant groups: ${variantSummary.length === 0 ? 'none' : variantSummary.join(' | ')}`,
    selectedMarkdown ? 'Scope: selected text only' : 'Scope: full document',
    '',
    '## Task',
    promptInstruction(mode),
    '',
    selectedMarkdown ? '## Selected Markdown' : '## Source Markdown',
    '---',
    sourceMarkdown,
  ].join('\n');
}

export function createLlmStyleGuide(): string {
  return toScieMDVisualSafeMarkdown([
    '# ScieMD Markdown Style Guide',
    '',
    'Use this guide when editing ScieMD Markdown in an external LLM.',
    '',
    '## Core Rules',
    '',
    '- Keep the file as readable Markdown.',
    '- Preserve YAML front matter unless asked to change document metadata.',
    '- Preserve relative asset paths such as `assets/figure.png`.',
    '- Preserve citations such as `[@smith2026]` and cross-references such as `@fig-surface`.',
    '- Preserve labels such as `{#fig-surface}` and `{#tbl-results}`.',
    '- Preserve dynamic variables such as `{{reactor_temp}}` exactly. Use the evaluated value only for reasoning, not as a replacement in the Markdown.',
    '- Preserve fenced code blocks exactly unless asked to edit code.',
    '- Preserve variant history comments exactly: `<!-- scie_md:variant:group ... -->`, `<!-- scie_md:variant:item ... -->`, and `<!-- scie_md:variant:end -->`.',
    '- Preserve locked regions exactly: `<!-- scie_md:lock:start --> ... <!-- scie_md:lock:end -->`.',
    '- Use `<!-- scie_md:note kind="llm" id="..." target="quote" quote="selected text": instruction -->` for anchored instructions to external LLMs.',
    '- Preserve optional quote selector context such as `prefix="..."` and `suffix="..."`; use it with `quote` to identify the exact repeated occurrence.',
    '- When completing a `kind="llm"` note, remove that LLM note and add a nearby `kind="human"` note with `source="llm-note-id"` summarizing the edit.',
    '- Read the whole document for context, but keep edits local to the LLM note target unless the note explicitly asks for broader changes.',
    '- Use variables for repeated or reusable values; create meaningful `XXX` placeholder variables when a required value is unknown.',
    '- Use text versions when there are several useful responses and the human should choose.',
    '- Use `<!-- scie_md:instruction target="next-block" prompt="instruction" -->` for surgical block-level instructions.',
    '- Use `$...$` for inline math and `$$...$$` for display math.',
    '- Use fenced `mermaid` blocks for flowcharts, pipelines, and mechanism diagrams.',
    '- Do not return HTML, MDX, JSON, or comments about the edit unless asked.',
    '',
    '## Scientific Blocks',
    '',
    'Preferred block pattern:',
    '',
    '```markdown',
    ':::figure {#fig-surface}',
    '![Surface structure](assets/surface.png)',
    '',
    'A clear caption that can be referenced as @fig-surface.',
    ':::',
    '```',
    '',
    'Allowed directive names: figure, result, note, callout, tip, important, warning.',
    '',
  ].join('\n'));
}

export function createScieMDLlmSkill(): string {
  return toScieMDVisualSafeMarkdown([
    '---',
    'name: sciemd-authoring',
    'description: Use when reading, editing, generating, reviewing, or preserving ScieMD Markdown documents, especially documents that contain ScieMD semantic blocks, citations, variables, locked sections, LLM notes, LLM instructions, text versions, figures, references, or export-oriented scientific writing markup.',
    '---',
    '',
    '# ScieMD LLM Skill',
    '',
    'ScieMD is a local-first scientific Markdown editor designed for hybrid human/LLM writing. The Markdown file is the source of truth. Humans get a visual writing surface with typography, blocks, figures, citations, variables, references, review tools, and export previews. LLMs get explicit raw Markdown with semantic comments and directives that must be preserved.',
    '',
    'Use this skill whenever you are asked to edit or interpret a ScieMD document, or whenever the document contains `scie_md`, `scienfy`, semantic directive blocks, dynamic variables, citation keys, locked sections, LLM notes, LLM instructions, text versions, or generated reference sections.',
    '',
    'The intended collaboration model is note-driven: the human marks requests inside the Markdown as Note to LLM comments, provides you the document and this skill, and expects edits that answer those notes. Read the whole document for context, but do not rewrite unrelated text just because it is available.',
    '',
    '## Prime Directive',
    '',
    '- Return valid Markdown unless the user explicitly asks for another format.',
    '- Preserve the user\'s document structure, front matter, comments, labels, citations, variables, asset paths, and ScieMD control markers.',
    '- Do not flatten ScieMD semantic structures into prose.',
    '- Do not replace dynamic variable tokens with their evaluated values in the Markdown source.',
    '- Do not edit locked sections unless the user explicitly instructs you to unlock or modify protected content.',
    '- If you are unsure whether a marker is operational metadata, preserve it exactly.',
    '',
    '## File Shape',
    '',
    'A ScieMD file is normal Markdown with optional YAML front matter and optional ScieMD extensions. Typical front matter:',
    '',
    '```yaml',
    '---',
    'title: "Document title"',
    'author: "Author"',
    'bibliography: references.bib',
    'variables:',
    '  cohort_n: 128',
    '  p_value: "0.018"',
    'scienfy:',
    '  schema: 2',
    '  documentType: "paper"',
    '  visualStyle: "scienfy"',
    '  variablesFile:',
    '    - results.json',
    '---',
    '```',
    '',
    'Preserve front matter unless the task requires a metadata change. Keep `bibliography`, `variables`, and `scienfy` fields intact.',
    '',
    '## Dynamic Variables',
    '',
    'Variables use double braces:',
    '',
    '```markdown',
    'The cohort included {{ cohort_n }} participants and p = {{ p_value }}.',
    '```',
    '',
    '- Preserve `{{ variable_name }}` tokens exactly in edited Markdown.',
    '- Use variable values only for reasoning when they are supplied in front matter or supporting context.',
    '- Do not convert `{{ cohort_n }}` into `128` unless the user explicitly asks for a static export.',
    '- Variables may come from top-level front matter `variables`, legacy `scienfy.variables`, or linked JSON/CSV files via `scienfy.variablesFile`.',
    '- Prefer adding new document-local values under top-level `variables:` because ScieMD variable editing maintains that section.',
    '- Actively look for variable opportunities during every edit. Do not wait for the human to explicitly ask for variables.',
    '- Strongly prefer variables for repeated or reusable values, sample sizes, p-values, confidence intervals, thresholds, model names, instrument settings, reagent names, condition labels, dates, file names, cohort names, project names, and other values the human may later want to update in one place.',
    '- Reuse an existing variable when it already represents the value. Do not create a second variable for the same concept under a different name.',
    '- If a Note to LLM asks you to change a repeated value that is already variable-backed, update the variable definition once rather than editing each rendered occurrence.',
    '- If repeated hard-coded values appear in the target or nearby context, consider converting them to one variable and replacing all local matching occurrences that clearly refer to the same concept.',
    '- If no front matter exists and a variable is clearly useful, create minimal YAML front matter with a top-level `variables:` map, preserving the rest of the document unchanged.',
    '- Use meaningful snake_case names such as `coating_cycles`, `spray_pressure_kpa`, `cohort_n`, or `primary_endpoint`. Avoid vague names such as `value1` or `temp` when a domain-specific name is available.',
    '- If a requested edit needs a value that is not available, create a meaningful placeholder variable instead of inventing the value. Set it to `XXX`, use the token in the prose, and leave the human a Note to Human if attention is needed.',
    '- Do not create variables for ordinary one-off prose, rhetorical wording, or values that are clearly used once and unlikely to be reused.',
    '- Missing variables should remain as tokens and can be reported to the user.',
    '',
    'Variable upgrade example:',
    '',
    '```markdown',
    '---',
    'variables:',
    '  coating_cycles: 12',
    '  target_humidity: XXX',
    '---',
    '',
    'The coating used {{ coating_cycles }} spray cycles. Samples were conditioned at {{ target_humidity }}% relative humidity.',
    '',
    '<!-- scie_md:note id="human-variable-1" kind="human" target="cursor": Added `target_humidity` as an `XXX` placeholder variable; please fill the measured value before submission. -->',
    '```',
    '',
    'Before introducing a variable, verify the repeated occurrences mean the same thing. For example, two different temperatures in different experiments should not share one variable unless the text clearly says they are the same setting.',
    '',
    '## Citations, Bibliographies, And Cross-References',
    '',
    '- Citations use Pandoc-like keys such as `[@smith2026]`, `[see @smith2026; @lee2025]`, or `@smith2026`.',
    '- Preserve citation keys exactly.',
    '- Cross-references use labels such as `@fig-workflow`, `@tbl-results`, or `@eq-model`.',
    '- Labels often appear in attributes such as `{#fig-workflow}`. Preserve them exactly.',
    '- Auto-rendered references use:',
    '',
    '```markdown',
    ':::references',
    ':::',
    '```',
    '',
    'Do not replace `:::references` with a manually formatted bibliography unless explicitly asked.',
    '',
    '## Semantic Blocks',
    '',
    'ScieMD uses fenced directive blocks for semantic scientific content. Keep the directive wrapper and attributes.',
    '',
    '```markdown',
    ':::note',
    'A note for readers.',
    ':::',
    '',
    ':::warning',
    'A limitation or caveat.',
    ':::',
    '',
    ':::result',
    'A key finding.',
    ':::',
    '',
    ':::figure {#fig-workflow}',
    '![Workflow](assets/workflow.png)',
    '',
    'Caption text that can be referenced as @fig-workflow.',
    ':::',
    '```',
    '',
    'Known directive names include `figure`, `result`, `note`, `callout`, `tip`, `important`, `warning`, and `references`. Treat unknown directive names conservatively and preserve them.',
    '',
    '## Locked Sections',
    '',
    'Locked sections protect approved content from accidental LLM edits:',
    '',
    '```markdown',
    '<!-- scie_md:lock:start reason="approved-methods" -->',
    'Protected content.',
    '<!-- scie_md:lock:end -->',
    '```',
    '',
    'Rules:',
    '',
    '- Do not modify content inside locked sections unless the user explicitly says to edit or unlock it.',
    '- Preserve both lock comments and attributes exactly.',
    '- If the requested edit conflicts with a lock, explain that the locked section was preserved.',
    '',
    '## LLM Notes',
    '',
    'LLM notes are author-to-model guidance, not manuscript prose. They are the main way a ScieMD author asks an external LLM to edit the document:',
    '',
    '```markdown',
    '<!-- scie_md:note id="llm-1" kind="llm" target="quote" quote="selected sentence": Preserve numeric values and sharpen the explanation. -->',
    '```',
    '',
    'Important attributes:',
    '',
    '- `id` is the stable identifier for that request. Do not rewrite it while the Note to LLM is unresolved.',
    '- `kind="llm"` means the note is an instruction for you, the external LLM.',
    '- `kind="human"` means the note is for the human author. Preserve existing human notes unless explicitly asked to remove them.',
    '- `source="llm-note-id"` on a Note to Human links your completion note back to the Note to LLM you resolved.',
    '- `target` describes how the note is anchored. Common values are `quote`, `next-block`, `previous-block`, `block-range`, and `cursor`.',
    '- `quote` stores the visible text selected by the human. Use it to identify the intended target; do not treat the quote attribute as extra manuscript text.',
    '- `prefix` and `suffix`, when present, store nearby visible text before and after the selected quote. Use the `prefix` + `quote` + `suffix` triple to disambiguate repeated text, and preserve those attributes exactly if the marker remains unresolved.',
    '',
    'How to act on notes:',
    '',
    '1. Skim the whole document first so you understand context, terminology, citations, variables, locks, and neighboring claims.',
    '2. Find every `scie_md:note` with `kind="llm"` and decide which notes you can complete.',
    '3. Keep the edit local to the highlighted, quoted, or otherwise targeted text unless the note explicitly asks for a broader change.',
    '4. If the note asks for a broader change, make the smallest coherent document-wide edit that satisfies the note.',
    '5. If you fully complete a Note to LLM, remove that Note to LLM from the Markdown.',
    '6. Add a nearby Note to Human with a new human-facing `id`, `kind="human"`, and `source` equal to the completed LLM note id. Summarize what you changed and any decision the human should review.',
    '7. If you cannot complete a Note to LLM, preserve it exactly and optionally add a Note to Human explaining the blocker.',
    '',
    'Do not treat Note to Human as another edit request. Note to Human is a visible review explanation for the author after you finish or cannot finish a Note to LLM. The human accepts or rejects the text edit in ScieMD review; linked Note to Human markers follow that decision and do not need separate acceptance by the LLM.',
    '',
    'Completion example:',
    '',
    '```markdown',
    '<!-- scie_md:note id="human-1" kind="human" source="llm-1" target="quote" quote="selected sentence": Revised the selected sentence for clarity while preserving the numeric claim and citation. -->',
    '```',
    '',
    'Legacy ranged notes may wrap content:',
    '',
    '```markdown',
    '<!-- scie_md:comment audience="llm": Improve clarity only. -->',
    'Text being annotated.',
    '<!-- scie_md:comment:end -->',
    '```',
    '',
    'Treat legacy `scie_md:comment audience="llm"` comments as older LLM instructions. Preserve the wrapped target text and do not expose the comment as manuscript prose.',
    '',
    '## LLM Instructions',
    '',
    'Targeted instructions are surgical edit requests:',
    '',
    '```markdown',
    '<!-- scie_md:instruction target="next-block" prompt="Make this clearer while preserving every claim and number." -->',
    '```',
    '',
    'Rules:',
    '',
    '- Apply the instruction to its target when possible.',
    '- If fully completed, remove only the completed instruction comment.',
    '- If not completed, preserve the instruction comment.',
    '- Do not apply targeted instructions to unrelated sections.',
    '',
    '## Text Versions',
    '',
    'Text versions preserve alternative drafts while one active version is shown/exported:',
    '',
    '```markdown',
    '<!-- scie_md:variant:group id="abstract-tone" active="direct" -->',
    '<!-- scie_md:variant:item id="careful" name="Careful draft" -->',
    'A careful version.',
    '<!-- scie_md:variant:item id="direct" name="Direct draft" -->',
    'A direct version.',
    '<!-- scie_md:variant:end -->',
    '```',
    '',
    'Rules:',
    '',
    '- Preserve the group, item, and end comments exactly.',
    '- Edit only the active item unless the user asks to edit all versions.',
    '- Keep item IDs stable.',
    '- Do not delete inactive versions unless explicitly asked.',
    '- Actively consider text versions whenever you see multiple scientifically valid revisions, possible tones, possible structures, uncertain interpretation, reviewer-facing alternatives, or a request where the human should choose.',
    '- Prefer a direct edit when there is one clearly correct correction. Prefer text versions when there are two or more defensible choices.',
    '- It is encouraged to keep the original wording as version 1 and add your revised wording as version 2 when the revision changes framing, emphasis, strength of claim, or interpretation.',
    '- When adding a new variant group, use short stable IDs, clear human-readable names, and keep the active version set to the option you recommend unless the note says otherwise.',
    '- If you cannot confidently choose between versions, keep the original active and add a Note to Human explaining what decision is needed.',
    '- When a Note to LLM causes you to add versions, remove the completed Note to LLM and add a linked Note to Human describing the alternatives and your recommendation.',
    '- For sentence-level alternatives, use an anchored variant group with `target="quote"` and preserve any `prefix`/`suffix` selector context if present.',
    '- Do not use versions as a substitute for a normal direct edit when there is only one clearly correct revision.',
    '',
    'Anchored sentence-level version example:',
    '',
    '```markdown',
    '<!-- scie_md:variant:group id="claim-framing" active="v2" target="quote" quote="This design improves performance." prefix="Together, the data show" suffix="Additional tests" -->',
    '<!-- scie_md:variant:item id="v1" name="Original wording" -->',
    'This design improves performance.',
    '<!-- scie_md:variant:item id="v2" name="Cautious revision" -->',
    'This design is consistent with improved performance under the tested conditions.',
    '<!-- scie_md:variant:end -->',
    '',
    'Together, the data show This design improves performance. Additional tests are needed for deployment.',
    '',
    '<!-- scie_md:note id="human-version-1" kind="human" source="llm-1" target="cursor": Added a cautious alternative claim as the active version while preserving the original wording as a selectable version. -->',
    '```',
    '',
    'Block-level version example:',
    '',
    '```markdown',
    '<!-- scie_md:variant:group id="abstract-closing" active="v2" -->',
    '<!-- scie_md:variant:item id="v1" name="Original closing" -->',
    'This platform enables rapid screening.',
    '<!-- scie_md:variant:item id="v2" name="Mechanistic closing" -->',
    'This platform connects fabrication parameters to morphology outcomes during rapid screening.',
    '<!-- scie_md:variant:end -->',
    '```',
    '',
    '## Math, Code, Tables, And Diagrams',
    '',
    '- Use `$...$` for inline math and `$$...$$` for display math.',
    '- Preserve fenced code blocks exactly unless the task is to edit code.',
    '- Use fenced `mermaid` blocks for flowcharts or process diagrams.',
    '- Preserve Markdown tables and alignment rows.',
    '- Avoid HTML unless the user explicitly asks for it.',
    '',
    '## Images And Assets',
    '',
    '- Preserve relative paths such as `assets/figure.png`.',
    '- Preserve alt text and labels.',
    '- Do not inline binary data or base64 images into Markdown unless explicitly asked.',
    '',
    '## Conflict Markers',
    '',
    'ScieMD may preserve overlapping local and disk edits with standard conflict markers:',
    '',
    '```markdown',
    '<<<<<<< ScieMD local edits',
    'Local edited version.',
    '=======',
    'Incoming disk version.',
    '>>>>>>> Disk changes',
    '```',
    '',
    'Rules:',
    '',
    '- If conflict markers are present, resolve them before finalizing the Markdown.',
    '- Preserve the intended edited version, or merge both sides when both contain useful non-duplicated content.',
    '- Verify no `<<<<<<<`, `=======`, or `>>>>>>>` conflict markers remain in the final Markdown unless the user explicitly asks to keep them as examples.',
    '- Also verify no temporary explanatory comments remain unless they are intentional ScieMD comments such as `scie_md:note`, `scie_md:comment`, `scie_md:instruction`, lock markers, or variant markers.',
    '',
    '## Editing Workflow For LLMs',
    '',
    '1. Parse front matter first. Identify existing `variables`, linked variable files, bibliography files, document type, visual style, and any existing text version groups.',
    '2. Skim the whole document for context before editing. Read enough surrounding text to preserve terminology, claims, citations, and tone.',
    '3. Identify protected locks, Note to LLM markers, existing Note to Human markers, targeted instructions, text version groups, citations, cross-reference labels, semantic directive blocks, and conflict markers.',
    '4. Treat Note to LLM markers as the primary task queue. The user normally expects you to edit only in response to those notes.',
    '5. For each Note to LLM, locate the intended target from `target`, `quote`, optional `prefix`/`suffix`, source position, and surrounding text. Do not move the note to a different paragraph or bullet.',
    '6. Before editing each target, choose the editing strategy: direct edit, variable upgrade, text version, or a combination. Make this choice deliberately.',
    '7. Scan the target and immediate surrounding context for repeated or reusable values. Reuse existing variables or create new meaningful variables when that improves future human editing.',
    '8. Scan the target for legitimate alternatives. Use text versions when there are multiple defensible revisions, tones, structures, or interpretations that the human should be able to compare.',
    '9. Keep edits local to the note target unless the note explicitly requests broader document edits. Variable replacements may extend to nearby matching occurrences only when they clearly represent the same concept.',
    '10. Preserve locked content. If a note targets locked text and does not explicitly authorize editing the lock, leave the LLM note unresolved and add a Note to Human explaining why.',
    '11. When a Note to LLM is fully completed, delete only that Note to LLM and add a linked Note to Human with `source` equal to the completed note id. Mention any variables or text versions you added.',
    '12. Preserve citation keys, variable tokens, labels, relative paths, semantic blocks, front matter, and unresolved ScieMD control markers.',
    '13. Resolve any conflict markers and verify none remain unintentionally.',
    '14. Return revised Markdown only unless the user asks for explanation or a change summary.',
    '',
    '## Common Mistakes To Avoid',
    '',
    '- Replacing `{{ p_value }}` with `0.018` in source Markdown.',
    '- Ignoring Note to LLM markers and rewriting unrelated parts of the document.',
    '- Editing beyond the highlighted or quoted note target when the note did not ask for broader changes.',
    '- Ignoring `prefix` and `suffix` on quote anchors when repeated text appears nearby.',
    '- Completing a Note to LLM but leaving it in place instead of replacing it with a linked Note to Human.',
    '- Changing or reusing a Note to LLM `id` for a different request.',
    '- Hard-coding repeated values that should be represented as variables.',
    '- Creating duplicate variables for the same concept instead of reusing the existing variable.',
    '- Inventing missing values instead of creating a clear `XXX` placeholder variable.',
    '- Failing to use text versions when two or more scientifically defensible revisions should be compared by the human.',
    '- Overusing text versions for simple corrections where one direct edit is clearly right.',
    '- Deleting `scie_md:variant` comments because they look like ordinary comments.',
    '- Editing locked content without permission.',
    '- Turning `:::figure` or `:::warning` blocks into plain paragraphs.',
    '- Removing `:::references` and manually writing a bibliography.',
    '- Changing citation keys, labels, or asset paths.',
    '- Leaving unresolved `<<<<<<< ScieMD local edits`, `=======`, or `>>>>>>> Disk changes` markers in final Markdown.',
    '- Returning HTML or prose commentary when the user asked for a Markdown edit.',
    '',
    '## Minimal Response Contract',
    '',
    'When asked to revise a ScieMD document, return one of:',
    '',
    '- The complete revised Markdown document, if a full-document edit was requested.',
    '- The complete revised Markdown document after resolving the applicable Note to LLM markers, if the user supplied a full ScieMD file.',
    '- The revised selected Markdown, if the user supplied a selection and explicitly asked for selection-only editing.',
    '- A concise diagnostic list, if the user asked for review rather than rewriting.',
    '',
    'Do not wrap the final Markdown in an extra code fence unless the user specifically asks for a fenced response.',
    '',
  ].join('\n'));
}

function toScieMDVisualSafeMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const output: string[] = [];
  let inFrontmatter = /^---[ \t]*$/.test(lines[0] ?? '');
  let fenceChar: '`' | '~' | null = null;
  let fenceLength = 0;
  let previousOutputLineWasBlank = true;
  let previousOutputLineWasUnorderedList = false;

  const pushLine = (line: string, unorderedListLine: boolean) => {
    if (unorderedListLine && previousOutputLineWasUnorderedList && !previousOutputLineWasBlank) {
      output.push('');
      previousOutputLineWasBlank = true;
    }
    output.push(line);
    const blank = line.trim() === '';
    previousOutputLineWasBlank = blank;
    previousOutputLineWasUnorderedList = unorderedListLine && !blank;
    if (blank) previousOutputLineWasUnorderedList = false;
  };

  lines.forEach((line, index) => {
    if (inFrontmatter) {
      if (index > 0 && /^---[ \t]*$/.test(line)) inFrontmatter = false;
      pushLine(line, false);
      return;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const markerChar = marker[0] as '`' | '~';
      if (!fenceChar) {
        fenceChar = markerChar;
        fenceLength = marker.length;
      } else if (markerChar === fenceChar && marker.length >= fenceLength) {
        fenceChar = null;
        fenceLength = 0;
      }
      pushLine(line, false);
      return;
    }

    if (fenceChar) {
      pushLine(line, false);
      return;
    }

    const normalizedLine = line.replace(/^(\s*)[+*]\s+/, '$1- ');
    const unorderedListLine = /^ {0,3}-\s+(?:\[[ xX]\]\s+)?/.test(normalizedLine);
    pushLine(normalizedLine, unorderedListLine);
  });

  return output.join('\n');
}

function uniqueVariableDefinitions(definitions: VariableDefinition[]): VariableDefinition[] {
  const byName = new Map<string, VariableDefinition>();
  for (const definition of definitions) {
    byName.set(definition.name, definition);
  }
  return Array.from(byName.values());
}

function describeEditorNoteForPrompt(comment: ReturnType<typeof parseEditorComments>[number]): string {
  const id = comment.id ? `id ${comment.id}, ` : '';
  const target = comment.target === 'quote' && comment.quote
    ? `, quote "${truncatePromptValue(comment.quote, 96)}"`
    : comment.target
      ? `, target ${comment.target}`
      : '';
  const source = comment.sourceNoteId ? `, source ${comment.sourceNoteId}` : '';
  return `${id}line ${comment.line}${target}${source}: ${comment.body}`;
}

function truncatePromptValue(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function promptInstruction(mode: LlmPromptMode): string {
  if (mode === 'summarize') return 'Summarize this document with a concise executive summary and preserve the original Markdown after the summary.';
  if (mode === 'expand') return 'Expand the draft with clearer scientific detail while preserving the existing structure and Markdown syntax.';
  return 'Return only the revised Markdown unless explicitly asked for commentary.';
}
