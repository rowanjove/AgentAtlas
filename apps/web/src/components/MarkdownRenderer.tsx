import { Children, isValidElement, memo, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { Link } from 'react-router-dom';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { MermaidDiagram } from './MermaidDiagram';

export function extractPlainText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractPlainText).join('');
  if (isValidElement(node)) {
    return extractPlainText((node.props as { children?: ReactNode }).children);
  }
  return Children.toArray(node).map(extractPlainText).join('');
}

function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function replaceWikilinksInProseLine(line: string): string {
  let i = 0;
  let out = '';
  while (i < line.length) {
    if (line[i] === '`') {
      let tickEnd = i;
      while (tickEnd < line.length && line[tickEnd] === '`') tickEnd++;
      const ticks = line.slice(i, tickEnd);
      const closeIdx = line.indexOf(ticks, tickEnd);
      if (closeIdx !== -1) {
        out += line.slice(i, closeIdx + ticks.length);
        i = closeIdx + ticks.length;
        continue;
      }
      out += ticks;
      i = tickEnd;
      continue;
    }
    if (line[i] === '[' && line[i + 1] === '[') {
      const closeIdx = line.indexOf(']]', i + 2);
      if (closeIdx !== -1) {
        const inner = line.slice(i + 2, closeIdx);
        const [targetRaw, labelRaw] = inner.split('|');
        const target = targetRaw.split('#')[0].trim();
        const label = (labelRaw || target).trim();
        if (target) {
          out += `[${label}](/__wikilink__/${encodeURIComponent(target)})`;
          i = closeIdx + 2;
          continue;
        }
      }
    }
    out += line[i];
    i++;
  }
  return out;
}

function preprocessWikilinks(markdown: string): string {
  // Replace [[id|label]] or [[id]] outside fenced code blocks and inline code spans
  const lines = markdown.split(/\r?\n/);
  let activeFence: string | null = null;
  return lines
    .map((line) => {
      const fenceMatch = /^[ \t]*(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (!activeFence) {
          activeFence = marker[0];
        } else if (marker[0] === activeFence && line.trim().startsWith(marker[0].repeat(3))) {
          activeFence = null;
        }
        return line;
      }
      if (activeFence) return line;
      return replaceWikilinksInProseLine(line);
    })
    .join('\n');
}

interface MdastNode {
  type: string;
  value?: string;
  lang?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
}

function splitMathInText(text: string): MdastNode[] | null {
  const regex = /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?![0-9])/g;
  const nodes: MdastNode[] = [];
  let lastIndex = 0;
  let matchedAny = false;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    const full = m[0];
    const isBlock = Boolean(m[1]);
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (!inner || (!isBlock && /^\d[\d,.\s]*$/.test(inner))) {
      continue;
    }
    matchedAny = true;
    if (m.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, m.index) });
    }
    nodes.push({
      type: 'inlineCode',
      value: inner,
      data: { hProperties: { className: [isBlock ? 'atlas-math-display' : 'atlas-math-inline'] } },
    });
    lastIndex = m.index + full.length;
  }

  if (!matchedAny) return null;
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return nodes;
}

function remarkMathLite() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      if (!node.children || node.type === 'code' || node.type === 'inlineCode') return;
      const nextChildren: MdastNode[] = [];
      for (const child of node.children) {
        if (
          child.type === 'paragraph' &&
          child.children?.length === 1 &&
          child.children[0].type === 'text' &&
          typeof child.children[0].value === 'string'
        ) {
          const blockMatch = /^\$\$([\s\S]+?)\$\$$/.exec(child.children[0].value.trim());
          if (blockMatch) {
            nextChildren.push({
              type: 'code',
              lang: 'atlas-math-display',
              value: blockMatch[1].trim(),
            });
            continue;
          }
        }
        if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('$')) {
          const replaced = splitMathInText(child.value);
          if (replaced) {
            nextChildren.push(...replaced);
            continue;
          }
        }
        walk(child);
        nextChildren.push(child);
      }
      node.children = nextChildren;
    };
    walk(tree);
  };
}

function MathFormula({ tex, displayMode }: { tex: string; displayMode: boolean }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    import('katex')
      .then((mod) => {
        if (!active) return;
        const katex = mod.default ?? mod;
        const katexOpts = {
          displayMode,
          throwOnError: false,
          output: 'mathml',
          strict: 'ignore',
          trust: false,
          maxExpand: 1000,
          maxSize: 20,
        } as Parameters<typeof katex.renderToString>[1];
        const rendered = katex.renderToString(tex, katexOpts);
        setHtml(rendered);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [tex, displayMode]);

  if (!html) {
    return displayMode ? (
      <div className="my-3 text-center font-mono text-sm text-[var(--text-sec)]">{tex}</div>
    ) : (
      <span className="font-mono text-[0.92em]">{tex}</span>
    );
  }

  return displayMode ? (
    <div className="my-3 overflow-x-auto text-center" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className="inline-block align-middle" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https'],
  },
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'atlas-math-inline', 'atlas-math-display']],
    span: [...(defaultSchema.attributes?.span ?? []), ['className']],
  },
};

function CodeBlockWithCopy({ className, children }: { className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const raw = extractPlainText(children).replace(/\n$/, '');
  const langMatch = /language-([a-zA-Z0-9_-]+)/.exec(className || '');
  const lang = langMatch?.[1] || '';

  if (lang === 'atlas-math-display' || className?.includes('atlas-math-display')) {
    return <MathFormula tex={raw} displayMode />;
  }

  if (lang === 'mermaid') {
    return <MermaidDiagram chart={raw} />;
  }

  return (
    <div className="my-5 rounded-[var(--radius-md)] border border-[var(--border)] overflow-hidden bg-[var(--panel-sec)]">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--border)] text-xs text-[var(--text-sec)]">
        <span className="font-mono">{lang || 'code'}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              .writeText(raw)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
          className="inline-flex items-center gap-1 hover:text-[var(--text)] cursor-pointer transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="!m-0">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const REMARK_PLUGINS: ComponentProps<typeof ReactMarkdown>['remarkPlugins'] = [remarkGfm, remarkMathLite];
const REHYPE_PLUGINS: ComponentProps<typeof ReactMarkdown>['rehypePlugins'] = [
  [rehypeSanitize, sanitizeSchema],
  rehypeHighlight,
];

const MARKDOWN_COMPONENTS: Components = {
  h2({ children }) {
    const text = extractPlainText(children);
    return <h2 id={slugifyHeading(text)}>{children}</h2>;
  },
  h3({ children }) {
    const text = extractPlainText(children);
    return <h3 id={slugifyHeading(text)}>{children}</h3>;
  },
  h4({ children }) {
    const text = extractPlainText(children);
    return <h4 id={slugifyHeading(text)}>{children}</h4>;
  },
  code({ className, children, ...rest }) {
    if (className?.includes('atlas-math-inline')) {
      return <MathFormula tex={extractPlainText(children)} displayMode={false} />;
    }
    if (className?.includes('atlas-math-display')) {
      return <MathFormula tex={extractPlainText(children)} displayMode />;
    }
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === 'object' && 'props' in child) {
      const props = (child as { props: { className?: string; children?: ReactNode } }).props;
      return <CodeBlockWithCopy className={props.className}>{props.children}</CodeBlockWithCopy>;
    }
    return <pre>{children}</pre>;
  },
  a({ href, children }) {
    if (href?.startsWith('/__wikilink__/')) {
      const target = decodeURIComponent(href.slice('/__wikilink__/'.length));
      const dest = target.startsWith('case.')
        ? `/casebook/${encodeURIComponent(target)}`
        : `/library/${encodeURIComponent(target)}`;
      return (
        <Link
          to={dest}
          className="inline-flex items-center gap-0.5 text-[var(--primary)] underline decoration-dotted underline-offset-4 hover:decoration-solid font-medium"
        >
          {children}
        </Link>
      );
    }
    if (href?.startsWith('/')) {
      return (
        <Link to={href} className="text-[var(--primary)] underline underline-offset-2">
          {children}
        </Link>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[var(--primary)] underline underline-offset-2"
        title="外部参考链接（点击将在新标签页打开）"
      >
        <span>{children}</span>
        <ExternalLink className="h-3 w-3 inline" aria-hidden="true" />
      </a>
    );
  },
};

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  const processed = useMemo(() => preprocessWikilinks(content), [content]);

  return (
    <div className="atlas-prose">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
});
