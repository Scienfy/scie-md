import { AlertTriangle, ChevronDown, ChevronRight, Code2, Copy, FileCode2, MousePointer2, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  StructuredOperationIcon,
  StructuredOperationId,
  StructuredOperationItem,
  StructuredOperationSection,
} from '../app/structuredOperationRegistry';
import type { ContextMenuSection } from './ContextMenuCard';

export type StructuredOperationHandlerMap = Partial<Record<StructuredOperationId, () => void | Promise<void>>>;

export function structuredOperationSectionsToContextMenuSections(
  sections: readonly StructuredOperationSection[],
  handlers: StructuredOperationHandlerMap,
): ContextMenuSection[] {
  return sections.map((section) => ({
    id: section.id,
    label: section.label,
    items: section.items.map((item) => structuredOperationItemToContextMenuItem(item, handlers)),
  }));
}

function structuredOperationItemToContextMenuItem(
  item: StructuredOperationItem,
  handlers: StructuredOperationHandlerMap,
): ContextMenuSection['items'][number] {
  const handler = handlers[item.id];
  return {
    id: item.id,
    label: item.label,
    icon: iconForOperation(item.icon),
    shortcut: item.shortcut,
    disabled: item.disabled,
    disabledReason: item.disabledReason,
    danger: item.destructive,
    submenuHint: item.requiresReview
      ? item.sourcePreserving ? 'Review' : 'Confirm'
      : undefined,
    submenu: item.submenu
      ? structuredOperationSectionsToContextMenuSections(item.submenu, handlers)
      : undefined,
    onSelect: !item.disabled && handler ? handler : undefined,
  };
}

function iconForOperation(icon: StructuredOperationIcon) {
  switch (icon) {
    case 'copy':
      return <Copy size={18} />;
    case 'source':
      return <FileCode2 size={18} />;
    case 'edit':
      return <Pencil size={18} />;
    case 'add':
      return <Plus size={18} />;
    case 'delete':
      return <Trash2 size={18} />;
    case 'code':
      return <Code2 size={18} />;
    case 'expand':
      return <ChevronRight size={18} />;
    case 'collapse':
      return <ChevronDown size={18} />;
    case 'select':
      return <MousePointer2 size={18} />;
    case 'warning':
      return <AlertTriangle size={18} />;
  }
}
