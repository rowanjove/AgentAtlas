import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles, Save, AlertCircle, BookOpen, Square, X } from 'lucide-react';
import { resolveDomainFromNodeId } from '@agent-atlas/shared';
import { apiMutate } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { Badge, Button, Drawer, IconButton, Input, Select, toast } from './ui';

type TutorMode =
  | 'concept-explain'
  | 'deep-research'
  | 'socratic'
  | 'architecture-deduction'
  | 'design-review'
  | 'quiz-draft';
type LearningDepth = 'concept' | 'mechanism' | 'architecture' | 'practice';

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  mode?: 'live-model' | 'offline-retrieval';
  citations?: Array<{ nodeId: string; title: string; revision: number }>;
  disclosedNodeIds?: string[];
  warning?: string;
}

const MODES: Array<{ id: TutorMode; label: string }> = [
  { id: 'concept-explain', label: '概念解释' },
  { id: 'socratic', label: '苏格拉底提问' },
  { id: 'deep-research', label: '深度研究' },
  { id: 'architecture-deduction', label: '架构推演' },
  { id: 'design-review', label: '方案审查' },
  { id: 'quiz-draft', label: '出题与笔记' },
];

const QUICK_PROMPTS = [
  'Workflow 与 Agent 怎么选？',
  '为什么中文不能只用 trigram？',
  '如何防止间接提示注入？',
];

export function TutorPanel({ embedded = false }: { embedded?: boolean }) {
  const tutorOpen = useAppStore((s) => s.tutorOpen);
  const setTutorOpen = useAppStore((s) => s.setTutorOpen);
  const contextNodeId = useAppStore((s) => s.tutorContextNodeId);
  const setContextNodeId = useAppStore((s) => s.setTutorContextNodeId);
  const rightPanelWidth = useAppStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useAppStore((s) => s.setRightPanelWidth);

  const [mode, setMode] = useState<TutorMode>('concept-explain');
  const [depth, setDepth] = useState<LearningDepth>('mechanism');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, loading]);

  if (!embedded && !tutorOpen) return null;

  const cancelRequest = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  };

  const sendQuestion = async () => {
    const q = input.trim();
    if (!q || loading) return;
    const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: 'user', content: q };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await apiMutate<{
        mode: 'live-model' | 'offline-retrieval';
        answer: string;
        citations: Array<{ nodeId: string; title: string; revision: number }>;
        disclosedContextNodeIds: string[];
        warning?: string;
      }>(
        'POST',
        '/api/tutor/chat',
        {
          question: q,
          mode,
          depth,
          currentNodeId: contextNodeId || undefined,
          history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        },
        controller.signal,
      );
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.answer,
          mode: res.mode,
          citations: res.citations,
          disclosedNodeIds: res.disclosedContextNodeIds,
          warning: res.warning,
        },
      ]);
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      setMessages((m) => [
        ...m,
        {
          id: `e-${Date.now()}`,
          role: 'assistant',
          content: isAbort ? '已取消本次请求。' : `请求失败：${err instanceof Error ? err.message : '未知错误'}`,
        },
      ]);
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const saveAsDraft = async (msg: ChatMsg) => {
    const nodeId = contextNodeId || msg.citations?.[0]?.nodeId || 'agent.loop';
    const domain = resolveDomainFromNodeId(nodeId);
    const today = new Date().toISOString().slice(0, 10);
    try {
      await apiMutate('POST', '/api/content/drafts', {
        nodeId,
        title: `研究草稿 · ${nodeId}`,
        domain,
        markdown: `---\nid: draft.${Date.now()}\nslug: draft-${Date.now()}\ntitle: 待核实研究笔记\nenTitle: Unverified Draft\ntype: concept\ndomain: ${domain}\nlevel: intermediate\nsummary: 由 AI 导师辅助生成，待人工核实来源后发布。\nobjectives: [人工审核事实]\nsourceIds: [anthropic.effective-agents]\nverifiedAt: "${today}"\n---\n\n${msg.content}`,
        sourceNote: `Tutor (${msg.mode ?? 'offline'}) 引用: ${(msg.citations ?? []).map((c) => c.nodeId).join(', ') || '无'}`,
      });
      toast.success('已存入内容管理「草稿箱」', '仅人工审核后才会进入正式知识库。');
    } catch (err) {
      toast.error('保存草稿失败', err instanceof Error ? err.message : '未知错误');
    }
  };

  const controlsSection = (
    <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] space-y-2.5 text-[13px] shrink-0">
      <div className="flex flex-wrap gap-1.5">
        {MODES.map((m) => (
          <Button
            key={m.id}
            size="xs"
            variant="outline"
            active={mode === m.id}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-sec)]">深度</span>
          <Select
            aria-label="回答深度"
            controlSize="xs"
            value={depth}
            onChange={(e) => setDepth(e.target.value as LearningDepth)}
          >
            <option value="concept">概念入门</option>
            <option value="mechanism">运行机制</option>
            <option value="architecture">系统架构</option>
            <option value="practice">工程实操</option>
          </Select>
        </div>
        {contextNodeId && (
          <Badge tone="primary" className="font-mono">
            <BookOpen className="h-3 w-3" />
            <span>{contextNodeId}</span>
            <button
              type="button"
              onClick={() => setContextNodeId(null)}
              className="ml-1 hover:text-[var(--text)] cursor-pointer"
              aria-label="解除绑定当前节点"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
      </div>
    </div>
  );

  const streamBody = (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="space-y-3 text-[13px] text-[var(--text-sec)] py-2">
            <p className="leading-relaxed">
              提问时优先通过本地 FTS5 检索知识库依据。未配置外部端点时使用离线检索引导；可在设置中连接兼容模型。
            </p>
            <div className="space-y-1.5">
              <div className="text-xs text-[var(--text-muted)]">快捷提问</div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map((preset) => (
                  <Button key={preset} size="xs" variant="outline" onClick={() => setInput(preset)}>
                    {preset}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm ${
              msg.role === 'user'
                ? 'ml-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--selected-bg)] px-3.5 py-2.5'
                : 'border-b border-[var(--border)] pb-4 last:border-b-0'
            }`}
          >
            {msg.warning && (
              <div className="mb-2 flex items-start gap-1.5 text-xs text-[var(--warning)] bg-[var(--warning-bg)] rounded-[var(--radius-sm)] px-2.5 py-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{msg.warning}</span>
              </div>
            )}
            <MarkdownRenderer content={msg.content} />
            {msg.role === 'assistant' && (
              <div className="mt-3 pt-2.5 border-t border-[var(--border)] space-y-2 text-[13px]">
                {msg.disclosedNodeIds && msg.disclosedNodeIds.length > 0 && (
                  <div className="text-xs text-[var(--text-muted)] font-mono">
                    {msg.mode === 'live-model' ? '已提交上下文片段: ' : '本地检索参考节点: '}
                    {msg.disclosedNodeIds.join(', ')}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {(msg.citations ?? []).map((c) => (
                      <Link
                        key={c.nodeId}
                        to={`/library/${encodeURIComponent(c.nodeId)}`}
                        className="px-2 py-0.5 rounded-[var(--radius-xs)] border border-[var(--border)] bg-[var(--panel-sec)] hover:border-[var(--primary)] font-mono text-xs"
                      >
                        {c.nodeId}
                      </Link>
                    ))}
                  </div>
                  <Button
                    size="xs"
                    variant="ghost"
                    leftIcon={<Save className="h-3 w-3" />}
                    onClick={() => saveAsDraft(msg)}
                  >
                    存为草稿
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={scrollEndRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion();
        }}
        className="p-3 border-t border-[var(--border)] flex items-center gap-2 bg-[var(--panel)] shrink-0"
      >
        <div className="flex-1 min-w-0">
          <Input
            type="text"
            controlSize="md"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入架构疑问或概念问题..."
          />
        </div>
        {loading ? (
          <Button variant="destructive" size="md" leftIcon={<Square className="h-3.5 w-3.5" />} onClick={cancelRequest}>
            取消
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="md" disabled={!input.trim()} leftIcon={<Send className="h-3.5 w-3.5" />}>
            发送
          </Button>
        )}
      </form>
    </div>
  );

  if (embedded) {
    return (
      <div className="h-full grid grid-cols-1 lg:grid-cols-12 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <aside className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-[var(--border)] bg-[var(--bg)] flex flex-col">
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--primary)]" />
            <h1 className="text-sm font-semibold">AI 工程研究助手</h1>
          </div>
          {controlsSection}
          <div className="p-4 text-[13px] text-[var(--text-sec)] space-y-2 hidden lg:block">
            <div className="font-medium text-[var(--text)]">研究准则</div>
            <p className="leading-relaxed">
              所有回答均受限于本地已核实知识索引；生成的总结可保存至「内容管理 / 草稿箱」待核实，绝不直接覆写正文。
            </p>
          </div>
        </aside>
        <div className="lg:col-span-8 flex flex-col min-h-0">{streamBody}</div>
      </div>
    );
  }

  return (
    <Drawer
      open={tutorOpen}
      onClose={() => setTutorOpen(false)}
      title="AI 导师"
      subtitle={contextNodeId ? `上下文: ${contextNodeId}` : '本地检索优先'}
      width={Math.max(360, rightPanelWidth)}
      minWidth={320}
      maxWidth={580}
      resizable
      onWidthChange={setRightPanelWidth}
    >
      <div className="h-full flex flex-col">
        {controlsSection}
        {streamBody}
      </div>
    </Drawer>
  );
}
