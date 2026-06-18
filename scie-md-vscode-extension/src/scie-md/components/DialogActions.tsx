import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

interface DialogActionsProps {
  children: ReactNode;
  align?: 'end' | 'between';
}

export function DialogActions({ children, align = 'end' }: DialogActionsProps) {
  const orderedChildren = Children.toArray(children).sort((left, right) => (
    actionPriority(left) - actionPriority(right)
  ));

  return (
    <footer className={`dialog-actions dialog-actions-${align}`}>
      {orderedChildren}
    </footer>
  );
}

function actionPriority(child: ReactNode): number {
  if (!isValidElement(child)) return 1;
  const className = String((child as ReactElement<{ className?: string }>).props.className ?? '');
  if (/\bprimary\b/.test(className)) return 2;
  if (/\bdanger\b/.test(className)) return 1;
  return 0;
}
