import type { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';

export interface Word { from: number; to: number; text: string }

export function precedingWord(text: string, cursor: number): Word | null {
  const token = text.slice(0, cursor).match(/[\p{L}\p{M}\p{N}_'’]+$/u)?.[0];
  if (!token || !/^\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*$/u.test(token)) return null;
  // Do not correct a prefix when inserting a delimiter into the middle of a word.
  if (/^[\p{L}\p{M}\p{N}_'’]/u.test(text.slice(cursor))) return null;
  return { from: cursor - token.length, to: cursor, text: token };
}

// Includes standard Lezer names and Obsidian's token names. Fail closed when
// syntax parsing is unavailable rather than accidentally changing source code.
const EXCLUDED = /code|frontmatter|yaml|url|autolink|linkmark|linkdestination|wikilink|hmd-internal-link|hashtag|tag|html|comment|math|formatting-link/i;

export function isProse(state: EditorState, word: Word): boolean {
  const tree = ensureSyntaxTree(state, word.to, 50);
  if (!tree || tree.length < word.to) return false;
  for (const position of [word.from, Math.max(word.from, word.to - 1)]) {
    for (let node = tree.resolveInner(position, 1); node; node = node.parent!) {
      if (EXCLUDED.test(node.name)) return false;
    }
  }
  const line = state.doc.lineAt(word.from);
  const before = line.text.slice(0, word.from - line.from);
  const throughWord = line.text.slice(0, word.to - line.from);
  if (/^---\s*$/u.test(state.doc.line(1).text)) {
    let closed = false;
    for (let number = 2; number <= line.number; number++) {
      if (/^(?:---|\.\.\.)\s*$/u.test(state.doc.line(number).text)) { closed = true; break; }
    }
    if (!closed) return false;
  }
  // Guard Obsidian constructs whose token naming differs between editor modes.
  if (/(?:^|\s)#[^\s#]*$/u.test(before)) return false;
  if (before.lastIndexOf('[[') > before.lastIndexOf(']]')) return false;
  if (/(?:[a-z][a-z\d+.-]*:\/\/|www\.|mailto:|\b[\w.+-]+@)[^\s<>]*$/iu.test(throughWord)) return false;
  if (/!?\[[^\]]*\]\([^)]*$/u.test(before) || /^\s*\[[^\]]+\]:/u.test(line.text)) return false;
  const openTags: string[] = [];
  for (const match of before.matchAll(/<(\/?)([a-z][\w-]*)\b[^>]*>/giu)) {
    const name = match[2].toLowerCase();
    if (match[1]) { if (openTags.at(-1) === name) openTags.pop(); }
    else if (!/\/\s*>$/u.test(match[0]) && !/^(?:br|hr|img|input|wbr|meta|link)$/u.test(name)) openTags.push(name);
  }
  if (openTags.length) return false;
  // Conservative fallback for math when a mode exposes only generic tokens.
  let mathDelimiter: string | null = null;
  for (const match of before.matchAll(/(?<!\\)\$\$?/gu)) {
    if (!mathDelimiter) mathDelimiter = match[0];
    else if (mathDelimiter === match[0]) mathDelimiter = null;
  }
  if (mathDelimiter) return false;
  return true;
}
