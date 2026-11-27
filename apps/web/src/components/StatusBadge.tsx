import { ProgressStatus } from '@agent-atlas/shared';
import { Badge, type BadgeTone } from './ui';

const STATUS_META: Record<
  ProgressStatus,
  { label: string; tone: BadgeTone; dotColor: string }
> = {
  not_started: { label: '未学习', tone: 'neutral', dotColor: 'var(--text-muted)' },
  in_progress: { label: '学习中', tone: 'primary', dotColor: 'var(--primary)' },
  read: { label: '已阅读', tone: 'success', dotColor: 'var(--success)' },
  assessed: { label: '已自测', tone: 'success', dotColor: 'var(--success)' },
  needs_review: { label: '需复习', tone: 'warning', dotColor: 'var(--warning)' },
};

export function StatusBadge({ status, compact = false }: { status: ProgressStatus; compact?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.not_started;
  return (
    <Badge tone={meta.tone} className={compact ? 'px-1.5' : ''}>
      <span
        className="h-1.5 w-1.5 rounded-full shrink-0"
        style={{ backgroundColor: meta.dotColor }}
        aria-hidden="true"
      />
      {!compact && <span>{meta.label}</span>}
    </Badge>
  );
}
