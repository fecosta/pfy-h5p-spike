import {
  computeIsPassed,
  computeScoreScaled,
  computeVerb,
  type ScoredOutcome
} from '@spike/learning-contract';

const H5P_LOCAL_CONTENT_ID =
  'http://h5p.org/x-api/h5p-local-content-id';

export interface XapiStatement {
  verb?: { id?: string };
  object?: {
    definition?: { extensions?: Record<string, unknown> };
  };
  context?: { contextActivities?: { parent?: unknown } };
  result?: {
    score?: { raw?: number; max?: number; min?: number; scaled?: number };
    success?: boolean;
    completion?: boolean;
    duration?: string;
  };
}

export type Normalized =
  | { kind: 'outcome'; outcome: ScoredOutcome; verbId: string }
  | { kind: 'ignored'; reason: string; verbId: string | null };

/**
 * H5P statements from sub-content (a question inside a QuestionSet or Column)
 * carry context.contextActivities.parent. Only parent-less statements describe
 * the activity as a whole, which is the same rule H5P core itself uses to
 * decide whether to report completion.
 */
export function isTopLevel(statement: XapiStatement): boolean {
  return statement?.context?.contextActivities?.parent === undefined;
}

export function localContentId(statement: XapiStatement): string | null {
  const raw = statement?.object?.definition?.extensions?.[H5P_LOCAL_CONTENT_ID];
  return raw === undefined || raw === null ? null : String(raw);
}

/** ISO-8601 durations as emitted by H5P, e.g. "PT1M13.24S" → seconds. */
export function parseIso8601Duration(value: string | undefined): number | null {
  if (!value) return null;
  const match =
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value
    );
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  if (!y && !mo && !d && !h && !mi && !s) return null;
  const seconds =
    Number(y ?? 0) * 31536000 +
    Number(mo ?? 0) * 2592000 +
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(mi ?? 0) * 60 +
    Number(s ?? 0);
  return Math.round(seconds);
}

const COMPLETING_VERBS = new Set([
  'http://adlnet.gov/expapi/verbs/completed',
  'http://adlnet.gov/expapi/verbs/answered'
]);

/**
 * xAPI statement → PFY outcome.
 *
 * `passThreshold` comes from the PFY activity (its behavior), not from the
 * statement: the activity's pass criterion is a PFY product decision, whereas
 * the statement only reports what the learner did.
 */
export function normalizeStatement(
  statement: XapiStatement,
  passThreshold: number | null
): Normalized {
  const verbId = statement?.verb?.id ?? null;

  if (!verbId) {
    return { kind: 'ignored', reason: 'statement has no verb', verbId };
  }
  if (!isTopLevel(statement)) {
    return {
      kind: 'ignored',
      reason: 'sub-content statement (has context.contextActivities.parent)',
      verbId
    };
  }
  if (!COMPLETING_VERBS.has(verbId)) {
    return {
      kind: 'ignored',
      reason: `verb is not completed/answered`,
      verbId
    };
  }

  const result = statement.result ?? {};
  const score = result.score ?? {};

  const scoreRaw = typeof score.raw === 'number' ? score.raw : null;
  const scoreMax = typeof score.max === 'number' ? score.max : null;
  const scoreMin = typeof score.min === 'number' ? score.min : 0;

  // Prefer H5P's own scaled value when present, else derive it.
  const scoreScaled =
    typeof score.scaled === 'number'
      ? Math.min(1, Math.max(0, score.scaled))
      : computeScoreScaled(scoreRaw, scoreMax, scoreMin);

  // `success` is the only trustworthy pass signal the activity itself reports;
  // fall back to comparing against the PFY threshold when it is absent.
  const isPassed =
    typeof result.success === 'boolean'
      ? result.success
      : computeIsPassed(scoreScaled, passThreshold);

  const isCompleted =
    typeof result.completion === 'boolean'
      ? result.completion
      : verbId.endsWith('/completed');

  return {
    kind: 'outcome',
    verbId,
    outcome: {
      score_raw: scoreRaw,
      score_max: scoreMax,
      score_min: scoreMin,
      score_scaled: scoreScaled,
      pass_threshold: passThreshold,
      is_passed: isPassed,
      is_completed: isCompleted,
      duration_seconds: parseIso8601Duration(result.duration),
      verb: computeVerb(isCompleted, isPassed),
      // H5P computes scores in the browser. PFY's existing scorers are
      // server-authoritative; this is explicitly not that.
      score_provenance: 'client_reported'
    }
  };
}
