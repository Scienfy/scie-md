---
title: "ScieMD Tutorial"
author: "Scienfy"
bibliography: references.bib
variables:
  sample_count: "1500"
  throughput_gain: "sixfold"
  hands_on_reduction: "65-fold"
  p_value: "0.018"
  target_humidity: "XXX"
scienfy:
  schema: 2
  documentType: "paper"
  visualStyle: "science"
---

# ScieMD Quick Tour

ScieMD is for hybrid manuscript work: the human writes and reviews in a visual document, while an external LLM agent works directly on the same Markdown file. You do not have to re-explain every request in chat. Put the request where it belongs in the paper as a **Note to LLM**, give the LLM the ScieMD skill once, and let it resolve the notes in context.

Keep ScieMD open while an agentic app edits the saved `.md` file. When the file changes, use review to inspect the exact edits, accept or reject them, and keep writing. The manuscript stays readable for you and precise for the LLM: notes, locks, variables, text versions, citations, blocks, and figure labels remain explicit Markdown.

:::important {#imp-central-loop}
The core loop is document-first: write in ScieMD, leave Note to LLM markers on the exact text that needs help, let the LLM revise the file, then review the incoming edits in ScieMD.
:::

## The LLM collaboration loop

1. Draft in **Visual** mode so the paper reads like a manuscript.
2. Select a sentence, paragraph, or bullet and add a **Note to LLM** from the floating toolbar, slash menu, or command palette.
3. Use **LLM -> Copy ScieMD LLM Skill** once for the external LLM. The skill tells it how to read notes, preserve locks, use variables, create text versions, and add Note to Human markers.
4. Ask the external LLM agent to work through the Note to LLM requests in the saved document.
5. Keep ScieMD open. When the file changes or pasted revisions arrive, review the edits visually and accept or reject the text changes.
6. The LLM removes completed Note to LLM markers and adds **Note to Human** summaries explaining what changed. Those review notes are not manuscript prose.
7. Export only after the active text versions, variables, citations, figures, and notes look right.

## What each ScieMD tool is for

| Tool | Why it matters in a hybrid paper |
| --- | --- |
| **Note to LLM** | Anchors a request to the exact text the model should revise. The note is visible in ScieMD and transparent in Source mode. |
| **Note to Human** | Lets the LLM explain what it changed without contaminating the manuscript text. The human can remove it after review. |
| **Text versions** | Lets the LLM offer several phrasings for the same paragraph while only one version is active for export. |
| **Variables** | Keeps repeated values such as sample count, p value, temperature, humidity, and thresholds synchronized across the paper. |
| **Locks** | Protects approved claims, methods, or reviewer-agreed wording from accidental LLM edits. |
| **Blocks** | Turns results, caveats, notes, figures, and callouts into skimmable scientific structure instead of loose formatting. |
| **Review** | Shows what changed in the main text so the human can accept or reject actual manuscript edits. |

:::note {#nte-human-note-role}
Human notes are review explanations. Accept or reject the related text edit; the linked human note follows that decision. Extra human notes can remain in the document until you remove them.
:::

## Example: drafting a paper with an LLM

Imagine you are writing a paper about an automated spray-coating platform. You draft the first version, then mark only the parts where help is needed.

<!-- scie_md:note id="llm-quick-abstract" kind="llm" target="next-block": Revise this abstract candidate for a journal audience. Preserve the variables, keep the claim cautious, and create text versions if there are two strong options. -->

Spray coating is flexible for preparing functional thin films, but manual workflows make parameter exploration slow. We built a dual-line ultrasonic spray-coating platform that produced {{ sample_count }} linked SEM-image and process-metadata records, increased workflow throughput by {{ throughput_gain }}, and reduced hands-on time by {{ hands_on_reduction }} while preserving contamination-controlled deposition across sequential inks.

:::result {#res-demo-findings}
The result paragraph uses variables for reusable values: {{ sample_count }} records, {{ throughput_gain }} throughput, {{ hands_on_reduction }} less hands-on time, and p = {{ p_value }} for the primary comparison.
:::

The LLM should read the whole document for context, but edit locally unless the note asks for broader work. If it completes the note, it should remove the Note to LLM and add a linked Note to Human describing the change.

<!-- scie_md:note id="human-quick-abstract" kind="human" source="llm-quick-abstract" target="cursor": Example human note: the LLM would use this to summarize what it changed after revising the abstract. -->

## Use text versions for real choices

A good LLM revision often has more than one defensible answer. ScieMD text versions let the LLM keep alternatives inside the paper instead of sending a confusing chat list.

<!-- scie_md:variant:group id="abstract-claim" active="balanced" -->
<!-- scie_md:variant:item id="original" name="Original draft" -->
The platform made spray coating faster and easier.
<!-- scie_md:variant:item id="balanced" name="Balanced manuscript claim" -->
The platform converted spray coating from a manual fabrication step into a reproducible, metadata-rich workflow for thin-film screening.
<!-- scie_md:variant:item id="cautious" name="Cautious claim" -->
The platform supports more reproducible spray-coated thin-film studies by coupling automated fabrication with structured process metadata.
<!-- scie_md:variant:end -->

Only the active version exports. The inactive versions stay available for comparison until you delete them.

## Use variables like manuscript placeholders

Variables are the paper equivalent of named constants in code. If a value appears more than once, define it once and reuse it:

| Variable | Current value | Use |
| --- | --- | --- |
| `{{ sample_count }}` | {{ sample_count }} | Dataset size |
| `{{ throughput_gain }}` | {{ throughput_gain }} | Workflow comparison |
| `{{ hands_on_reduction }}` | {{ hands_on_reduction }} | Operator-time comparison |
| `{{ p_value }}` | {{ p_value }} | Statistical result |
| `{{ target_humidity }}` | {{ target_humidity }} | Placeholder needing human input |

If the LLM needs a value that is not known yet, it should create a meaningful variable with value `XXX` rather than inventing a number. The human can fill it later from the Data sidebar or Source mode.

## Lock text that should not move

Use locks for approved methods, reviewer-negotiated language, final claims, or any region the LLM should not touch.

<!-- scie_md:lock:start reason="approved methods wording" -->
All films were deposited with the same nozzle-substrate distance, carrier gas setting, and drying interval unless a parameter sweep explicitly changed that variable.
<!-- scie_md:lock:end -->

If a Note to LLM targets locked text, the LLM skill tells the model to leave the note unresolved unless the note explicitly authorizes changing the lock.

## Use blocks to make the paper skimmable

Blocks help both humans and LLMs understand what a paragraph is doing.

:::warning {#wrn-demo-caveat}
Do not let the LLM turn a caveat into a stronger claim. Warnings are useful for unresolved controls, incomplete statistics, or assumptions that must survive revision.
:::

:::callout {#callout-demo-workflow}
For a real paper pass, add Note to LLM markers to weak sections, lock approved methods, convert repeated values into variables, and ask the LLM to create text versions when tone or claim strength is uncertain.
:::

## Fast places to start

| Surface | Use it for |
| --- | --- |
| `/` slash menu | Blocks, variables, citations, tables, figures, notes, locks, and text versions. |
| Floating toolbar | Actions on selected text: Note to LLM, Note to Human, Lock, and Text versions. |
| **LLM** menu | Copy or generate the ScieMD LLM skill for external agents. |
| **Data** sidebar | Inspect and edit variables. |
| **Inspector** | Review readiness, LLM markers, validation, and document metadata. |
| **Source** mode | Inspect the exact Markdown the LLM will see. |

## Next step

Save this tutorial as your own `.md` file, add one Note to LLM to a sentence, copy the ScieMD LLM skill, and ask your external LLM agent to resolve the note in the saved document. Then come back to ScieMD and review the edit like a manuscript change, not a chat response.
