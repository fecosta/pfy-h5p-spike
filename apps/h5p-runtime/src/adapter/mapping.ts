import type { ActivityBehavior } from '@spike/learning-contract';

/**
 * H5P content params → PFY ActivityBehavior.
 *
 * There is no uniform place to read a pass criterion from in H5P: MultiChoice
 * carries `behaviour.passPercentage`, QuestionSet carries a top-level
 * `passPercentage`, and TrueFalse/Blanks/DragQuestion carry none at all
 * (measured across the legacy corpus). Anything that reports a score with no
 * stated criterion is treated as "all points required", which is what the
 * WordPress editor's own default implies.
 */
export function deriveBehavior(params: unknown): ActivityBehavior {
  const p = (params ?? {}) as Record<string, any>;
  const behaviour = (p.behaviour ?? {}) as Record<string, any>;

  const passPercentage =
    typeof behaviour.passPercentage === 'number'
      ? behaviour.passPercentage
      : typeof p.passPercentage === 'number'
        ? p.passPercentage
        : 100;

  return {
    allow_retry: behaviour.enableRetry !== false,
    allow_show_solution: behaviour.enableSolutionsButton === true,
    pass_percentage: Math.min(100, Math.max(0, passPercentage)),
    randomize_answers:
      typeof behaviour.randomAnswers === 'boolean'
        ? behaviour.randomAnswers
        : undefined,
    max_attempts: null
  };
}

/**
 * WordPress H5P names its exports `<title-slug>-<contentId>.h5p`. That trailing
 * integer is the only surviving link to the old installation, and PFY already
 * has a column for it (activities.legacy_h5p_content_id), so it is worth
 * recovering. Returns null when the filename does not carry one.
 */
export function parseLegacyWordPressId(filename: string): number | null {
  const match = /-(\d+)\.h5p$/i.exec(filename);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

export function slugify(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 120) || 'activity'
  );
}
