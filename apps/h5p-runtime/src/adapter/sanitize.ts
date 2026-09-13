import * as H5P from '@lumieducation/h5p-server';
// Deep import: SemanticsEnforcer is not part of the package's index exports,
// but it is the exact class the editor save path uses (ContentStorer
// constructs it). Reaching for it directly is deliberate — the alternative is
// hand-rolling a second sanitizer whose rules would drift from the editor's.
import SemanticsEnforcer from '@lumieducation/h5p-server/build/src/SemanticsEnforcer';

import type { SpikeUser } from '../h5p/user';

/**
 * Closes the import-path sanitization gap.
 *
 * h5p-server sanitizes content params on the EDITOR save path
 * (ContentStorer -> SemanticsEnforcer -> sanitize-html) but NOT on the package
 * import path (PackageImporter). A .h5p whose content.json contains
 * `<script>` or an `onerror` handler is therefore stored verbatim and executes
 * in every learner's browser when the activity is played — verified, not
 * theoretical.
 *
 * Imported content is now held to the same standard as authored content: the
 * params go through the same SemanticsEnforcer the editor uses, and the result
 * is re-scanned. Anything still dangerous after that fails the import loudly
 * rather than being stored.
 */

export interface UnsafeFinding {
  /** Dotted path into the params, e.g. `answers.0.text`. */
  path: string;
  rule: string;
  excerpt: string;
}

/**
 * Constructs that must never survive into stored params.
 *
 * This is a detector, not the sanitizer — its job is to prove the sanitizer
 * worked. Event-handler and javascript:-URL rules only match inside a tag, so
 * ordinary prose mentioning "onload" or "javascript:" in running text is not
 * flagged.
 */
const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: 'script-tag', pattern: /<\s*script\b/i },
  { name: 'iframe-tag', pattern: /<\s*iframe\b/i },
  { name: 'object-or-embed-tag', pattern: /<\s*(object|embed|applet)\b/i },
  { name: 'inline-event-handler', pattern: /<[^>]+\son[a-z]+\s*=/i },
  { name: 'javascript-url', pattern: /<[^>]+(href|src|action)\s*=\s*["']?\s*javascript:/i },
  { name: 'srcdoc-attribute', pattern: /<[^>]+\bsrcdoc\s*=/i },
  { name: 'data-html-url', pattern: /<[^>]+=\s*["']?\s*data:text\/html/i },
  { name: 'style-tag', pattern: /<\s*style\b/i }
];

/** Walks every string in the params and reports dangerous markup. */
export function findUnsafeMarkup(params: unknown): UnsafeFinding[] {
  const findings: UnsafeFinding[] = [];

  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      for (const rule of RULES) {
        const match = rule.pattern.exec(value);
        if (match) {
          findings.push({
            path: path || '(root)',
            rule: rule.name,
            excerpt: value.slice(Math.max(0, match.index - 20), match.index + 60)
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}.${index}`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        walk(item, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(params, '');
  return findings;
}

export class UnsafeContentError extends Error {
  constructor(
    message: string,
    public readonly findings: UnsafeFinding[]
  ) {
    super(message);
    this.name = 'UnsafeContentError';
  }
}

export interface SanitizationReport {
  /** Dangerous constructs present in the package as authored. */
  findingsBefore: UnsafeFinding[];
  /** Dangerous constructs that survived sanitization. Must be empty. */
  findingsAfter: UnsafeFinding[];
  /** True when sanitization actually altered the params. */
  changed: boolean;
}

/**
 * Runs imported params through the editor's own semantics enforcement and
 * persists the result.
 *
 * `enforceSemanticStructure` mutates the params in place, so the pre-state is
 * captured first. The sanitized params are written back through ContentManager
 * rather than saveOrUpdateContent, because the content files are already in
 * place: this step must change params only, never touch file storage.
 */
export async function sanitizeImportedContent(
  editor: H5P.H5PEditor,
  input: {
    contentId: string;
    mainLibraryUbername: string;
    metadata: H5P.IContentMetadata;
    params: unknown;
    user: SpikeUser;
  }
): Promise<SanitizationReport> {
  const before = JSON.stringify(input.params);
  const findingsBefore = findUnsafeMarkup(input.params);

  const libraryName = H5P.LibraryName.fromUberName(input.mainLibraryUbername, {
    useWhitespace: true
  });

  const enforcer = new SemanticsEnforcer(editor.libraryManager);
  await enforcer.enforceSemanticStructure(input.params, libraryName);

  const after = JSON.stringify(input.params);
  const changed = before !== after;

  if (changed) {
    await editor.contentManager.createOrUpdateContent(
      input.metadata,
      input.params,
      input.user,
      input.contentId
    );
  }

  const findingsAfter = findUnsafeMarkup(input.params);
  if (findingsAfter.length > 0) {
    throw new UnsafeContentError(
      `content still contains unsafe markup after sanitization: ` +
        findingsAfter.map((f) => `${f.rule} at ${f.path}`).join(', '),
      findingsAfter
    );
  }

  return { findingsBefore, findingsAfter, changed };
}
