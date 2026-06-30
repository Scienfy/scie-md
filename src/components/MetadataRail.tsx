import { AlertTriangle, Database, GitBranch, LockKeyhole, MessageSquareText, Quote, Sparkles } from 'lucide-react';
import { memo } from 'react';
import type { ParsedScienfyDocument } from '@sciemd/core';
import type { EditorComment } from '@sciemd/core';
import type { ProtectedBlock } from '@sciemd/core';
import type { TargetedInstruction } from '@sciemd/core';
import type { VariantGroup } from '@sciemd/core';

interface MetadataRailProps {
  mode?: 'visual' | 'source';
  document: ParsedScienfyDocument;
  protectedBlocks: ProtectedBlock[];
  editorComments: EditorComment[];
  targetedInstructions: TargetedInstruction[];
  variantGroups: VariantGroup[];
  currentLine: number;
  onJumpToLine: (line: number) => void;
  onOpenReferences: () => void;
  onOpenData: () => void;
}

interface RailItem {
  id: string;
  line: number;
  kind: 'lock' | 'llm-comment' | 'human-comment' | 'instruction' | 'variant' | 'citation' | 'variable';
  label: string;
  detail: string;
  severity?: 'warning' | 'error';
  onClick?: () => void;
}

export const MetadataRail = memo(function MetadataRail({
  mode = 'source',
  document,
  protectedBlocks,
  editorComments,
  targetedInstructions,
  variantGroups,
  currentLine,
  onJumpToLine,
  onOpenReferences,
  onOpenData,
}: MetadataRailProps) {
  const items = buildRailItems({
    mode,
    document,
    protectedBlocks,
    editorComments,
    targetedInstructions,
    variantGroups,
    onOpenReferences,
    onOpenData,
  });

  if (items.length === 0) return null;

  return (
    <aside className="metadata-rail" aria-label="Document metadata rail">
      <div className="metadata-rail-icons" aria-hidden="false">
        {items.slice(0, 64).map((item) => {
          const nearCurrentLine = Math.abs(item.line - currentLine) <= 2;
          return (
            <button
              key={item.id}
              type="button"
              className={`metadata-rail-item ${item.kind} ${item.severity ?? ''} ${nearCurrentLine ? 'active' : ''}`}
              aria-label={`${item.label}, line ${item.line}`}
              data-tooltip={railItemTooltip(item)}
              data-tooltip-title={item.label}
              data-tooltip-detail={railItemDetail(item)}
              data-tooltip-meta={`Line ${item.line}`}
              data-tooltip-kind={item.severity ?? item.kind}
              data-tooltip-placement="left"
              onClick={() => {
                item.onClick?.();
                onJumpToLine(item.line);
              }}
            >
              {iconForKind(item.kind)}
            </button>
          );
        })}
      </div>
    </aside>
  );
});

function buildRailItems({
  document,
  protectedBlocks,
  editorComments,
  targetedInstructions,
  variantGroups,
  onOpenReferences,
  onOpenData,
}: Omit<MetadataRailProps, 'currentLine' | 'onJumpToLine'>): RailItem[] {
  const items: RailItem[] = [];
  for (const block of protectedBlocks) {
    items.push({
      id: `lock-${block.start}-${block.end}`,
      kind: 'lock',
      line: block.startLine,
      label: 'Locked section',
      detail: block.reason ?? 'Protected from external LLM edits',
    });
  }
  for (const comment of editorComments) {
    items.push({
      id: comment.id ? `comment-${comment.id}` : `comment-${comment.line}-${comment.body}`,
      kind: comment.audience === 'human' ? 'human-comment' : 'llm-comment',
      line: comment.line,
      label: comment.audience === 'human' ? 'Note to Human' : 'Note to LLM',
      detail: comment.body,
    });
  }
  for (const instruction of targetedInstructions) {
    items.push({
      id: `instruction-${instruction.start}-${instruction.end}`,
      kind: 'instruction',
      line: instruction.line,
      label: 'LLM instruction',
      detail: `${instruction.target}: ${instruction.prompt}`,
    });
  }
  for (const group of variantGroups) {
    items.push({
      id: `variant-${group.id}-${group.line}`,
      kind: 'variant',
      line: group.line,
      label: 'Versions',
      detail: `${group.items.length} alternatives, active ${group.active}`,
    });
  }
  for (const key of document.citations.missingKeys) {
    const usage = document.citations.usages.find((item) => item.key === key);
    if (!usage) continue;
    items.push({
      id: `missing-citation-${key}-${usage.line}`,
      kind: 'citation',
      line: usage.line,
      label: `@${key}`,
      detail: 'Missing from loaded bibliography',
      severity: 'warning',
      onClick: onOpenReferences,
    });
  }
  for (const name of document.variables.missingVariables) {
    const usage = document.variables.usages.find((item) => item.name === name);
    if (!usage) continue;
    items.push({
      id: `missing-variable-${name}-${usage.line}`,
      kind: 'variable',
      line: usage.line,
      label: `{{${name}}}`,
      detail: 'Missing from front matter and linked data files',
      severity: 'warning',
      onClick: onOpenData,
    });
  }
  return items.sort((left, right) => left.line - right.line || left.id.localeCompare(right.id));
}

function railItemTooltip(item: RailItem): string {
  const detail = item.detail.trim();
  const summary = detail ? `${item.label}: ${truncateDetail(detail)}` : item.label;
  return `${summary} (line ${item.line})`;
}

function railItemDetail(item: RailItem): string {
  return truncateDetail(item.detail, 120);
}

function truncateDetail(detail: string, maxLength = 180): string {
  const normalized = detail.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trimEnd()}...` : normalized;
}

function iconForKind(kind: RailItem['kind']) {
  if (kind === 'lock') return <LockKeyhole size={14} />;
  if (kind === 'llm-comment' || kind === 'human-comment') return <MessageSquareText size={14} />;
  if (kind === 'instruction') return <Sparkles size={14} />;
  if (kind === 'variant') return <GitBranch size={14} />;
  if (kind === 'citation') return <Quote size={14} />;
  if (kind === 'variable') return <Database size={14} />;
  return <AlertTriangle size={14} />;
}
