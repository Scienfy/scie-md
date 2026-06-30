import type { VariableDefinition } from '@sciemd/core';
import { substituteVariablesWithDefinitions } from '@sciemd/core';
import { fencedCodeRanges, isOffsetInsideRanges } from '@sciemd/core';
import { renderActiveVariants } from '@sciemd/core';

export function compileMarkdownForOutput(markdown: string, variableDefinitions: VariableDefinition[] = []): string {
  return substituteVariablesWithDefinitions(renderActiveVariants(markdown), variableDefinitions, { escapeMarkdown: true });
}

export function prepareMarkdownForLlm(markdown: string, variableDefinitions: VariableDefinition[] = []): string {
  void variableDefinitions;
  return markdown;
}

export function prepareMarkdownForHtmlExport(markdown: string, variableDefinitions: VariableDefinition[] = []): string {
  return stripScieMDOperationalComments(compileMarkdownForOutput(markdown, variableDefinitions));
}

export function prepareMarkdownForPandocExport(markdown: string, variableDefinitions: VariableDefinition[] = []): string {
  return convertPageBreakDirectives(stripScieMDOperationalComments(compileMarkdownForOutput(markdown, variableDefinitions)));
}

export function prepareMarkdownForRichText(markdown: string, variableDefinitions: VariableDefinition[] = []): string {
  return stripScieMDOperationalComments(compileMarkdownForOutput(markdown, variableDefinitions));
}

export function prepareMarkdownForOutput(markdown: string, variableDefinitions: VariableDefinition[] = []): string {
  return prepareMarkdownForLlm(markdown, variableDefinitions);
}

export function stripScieMDOperationalComments(markdown: string): string {
  return stripOutsideFences(
    stripOutsideFences(
      stripOutsideFences(
        stripOutsideFences(
          markdown,
          /<!--\s*scie_md:note[\s\S]*?-->\r?\n?/gi,
        ),
        /<!--\s*scie_md:comment[\s\S]*?-->\r?\n?/gi,
      ),
      /<!--\s*scie_md:instruction[\s\S]*?-->\r?\n?/gi,
    ),
    /<!--\s*scie_md:(?:lock(?::start|:end)?|bibliography:start|bibliography:end)\b[\s\S]*?-->\r?\n?/gi,
  );
}

function stripOutsideFences(markdown: string, pattern: RegExp): string {
  const ignoredRanges = fencedCodeRanges(markdown);
  return markdown.replace(pattern, (raw, offset: number) => (
    isOffsetInsideRanges(offset, ignoredRanges) ? raw : ''
  ));
}

export function convertPageBreakDirectives(markdown: string): string {
  const ignoredRanges = fencedCodeRanges(markdown);
  return markdown.replace(/^:::\s*pagebreak\s*\r?\n:::\s*$/gim, (raw, offset: number) => (
    isOffsetInsideRanges(offset, ignoredRanges) ? raw : '\\newpage'
  ));
}
