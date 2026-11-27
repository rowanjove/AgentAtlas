import fs from 'node:fs';
import path from 'node:path';

/**
 * Ensures a user-provided relative path stays strictly inside baseDir,
 * blocking path traversal (`..`), absolute paths, drive letters, null bytes,
 * and symlink escapes.
 */
export function assertSafeRelativePath(baseDir: string, relativeInput: string): string {
  if (!relativeInput || typeof relativeInput !== 'string') {
    throw new Error('Path traversal blocked: empty or invalid path');
  }
  if (relativeInput.includes('\0')) {
    throw new Error('Path traversal blocked: null byte detected');
  }
  const normalizedInput = relativeInput.replace(/\\/g, '/');
  if (
    path.isAbsolute(relativeInput) ||
    normalizedInput.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalizedInput)
  ) {
    throw new Error(`Path traversal blocked: absolute path not allowed (${relativeInput})`);
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, normalizedInput);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: escapes base directory (${relativeInput})`);
  }

  // Check realpath on existing ancestor to prevent symlink escapes
  const realBase = fs.existsSync(resolvedBase) ? fs.realpathSync(resolvedBase) : resolvedBase;
  let probe = resolvedTarget;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (fs.existsSync(probe)) {
    const realProbe = fs.realpathSync(probe);
    const realRel = path.relative(realBase, realProbe);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new Error(`Path traversal blocked: symlink escape detected (${relativeInput})`);
    }
  }

  return resolvedTarget;
}

const UNSAFE_PATTERNS: Array<{ code: string; regex: RegExp; reason: string; normalizeEntities?: boolean }> = [
  { code: 'UNSAFE_SCRIPT_TAG', regex: /<\s*script\b/i, reason: 'Executable <script> tag is prohibited' },
  { code: 'UNSAFE_IFRAME_TAG', regex: /<\s*iframe\b/i, reason: 'Embedded <iframe> tag is prohibited' },
  { code: 'UNSAFE_OBJECT_EMBED', regex: /<\s*(object|embed|applet)\b/i, reason: 'Plugin/object tag is prohibited' },
  { code: 'UNSAFE_HTML_TAG', regex: /<\s*(svg|math|style|meta|base|form|link)\b/i, reason: 'Potentially active HTML tag is prohibited in Markdown prose' },
  { code: 'UNSAFE_EVENT_HANDLER', regex: /<[a-z](?:[^>"']|"[^"]*"|'[^']*')*[\s/]on[a-z]+\s*=/i, reason: 'Inline DOM event handler attribute is prohibited' },
  { code: 'UNSAFE_JS_URI', regex: /\b(?:javascript|vbscript|data:text\/html)\s*:/i, reason: 'Executable URI scheme is prohibited', normalizeEntities: true },
  { code: 'UNSAFE_MDX_IMPORT', regex: /^(?:import|export)\s+(?:default\s+|\{|[a-zA-Z_$])/m, reason: 'Executable MDX import/export statement is prohibited outside fenced code blocks' },
];

/**
 * Strips fenced code blocks (line-anchored) and inline code spans outside HTML tags
 * so teaching examples in backticks stay allowed while `<tag attr=`payload`>` cannot bypass.
 */
export function stripCodeBlocks(markdown: string): string {
  const withoutFences = markdown.replace(
    /(?:^|\r?\n)[ \t]*(`{3,}|~{3,})[^\r\n]*(?:\r?\n[\s\S]*?)?(?:\r?\n[ \t]*\1[ \t]*(?=\r?\n|$)|$)/g,
    '\n',
  );

  const outLines: string[] = [];
  for (const line of withoutFences.split(/\r?\n/)) {
    let i = 0;
    let out = '';
    while (i < line.length) {
      const ch = line[i];
      if (ch === '<' && i + 1 < line.length && /[a-zA-Z!/]/.test(line[i + 1])) {
        let j = i + 1;
        let quote: string | null = null;
        while (j < line.length) {
          const c = line[j];
          if (quote) {
            if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
            quote = c;
          } else if (c === '>') {
            j++;
            break;
          }
          j++;
        }
        out += line.slice(i, j);
        i = j;
        continue;
      }

      if (ch === '`') {
        let tickEnd = i;
        while (tickEnd < line.length && line[tickEnd] === '`') tickEnd++;
        const ticks = line.slice(i, tickEnd);
        const closeIdx = line.indexOf(ticks, tickEnd);
        if (closeIdx !== -1) {
          out += ' ';
          i = closeIdx + ticks.length;
          continue;
        }
        out += ticks;
        i = tickEnd;
        continue;
      }

      out += ch;
      i++;
    }
    outLines.push(out);
  }
  return outLines.join('\n');
}

export function detectUnsafeHtmlOrMdx(markdown: string): Array<{ code: string; reason: string }> {
  const proseOnly = stripCodeBlocks(markdown);
  const entityNormalized = proseOnly
    .replace(/&#0*58;?|&#x0*3a;?|&colon;?/gi, ':')
    .replace(/[\u0000-\u001f\u007f]+/g, '');
  const findings: Array<{ code: string; reason: string }> = [];
  for (const rule of UNSAFE_PATTERNS) {
    const target = rule.normalizeEntities ? entityNormalized : proseOnly;
    if (rule.regex.test(target)) {
      findings.push({ code: rule.code, reason: rule.reason });
    }
  }
  return findings;
}

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
