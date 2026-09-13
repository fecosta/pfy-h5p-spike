/**
 * PFY learning contract.
 *
 * This package is the canonical PFY domain. It deliberately contains NO H5P or
 * Lumi concepts: no content ids, no library names (except the legacy migration
 * columns PFY itself already defines), no xAPI statements, no filesystem paths.
 * Everything H5P-shaped is translated in apps/h5p-runtime/src/adapter before it
 * reaches these types.
 *
 * Field names mirror the real PFY model that already exists in
 * repos/pfy-platform, so spike output maps 1:1 onto production:
 *   - packages/activity-engine/src/types/{activity,attempt}.ts
 *   - apps/api/database/migrations/*_create_activity_tables.php
 */
import { z } from 'zod';

// ─── Verbs & provenance ──────────────────────────────────────────────────────

/** Matches activity_attempts.verb in pfy-platform. */
export const VERBS = ['answered', 'completed', 'passed', 'failed'] as const;
export type Verb = (typeof VERBS)[number];

/**
 * Spike-proposed extension, not present in pfy-platform today.
 *
 * PFY currently re-computes every score on the server (ScorerRegistry +
 * AttemptRecorder), so a score is only ever as trustworthy as the server. H5P
 * activities score in the browser and report the result, which is a different
 * trust model. Rather than silently mixing the two, results carry where the
 * score came from.
 */
export const SCORE_PROVENANCE = ['server_authoritative', 'client_reported'] as const;
export type ScoreProvenance = (typeof SCORE_PROVENANCE)[number];

// ─── Activity ────────────────────────────────────────────────────────────────

/** Mirrors ActivityBehavior in @pfy/activity-engine. */
export interface ActivityBehavior {
  allow_retry: boolean;
  allow_show_solution: boolean;
  /** 0–100. */
  pass_percentage: number;
  randomize_answers?: boolean;
  max_attempts: number | null;
}

/**
 * A PFY activity, as the domain sees it.
 *
 * Note what is absent: there is no H5P content id here. The runtime keeps that
 * mapping privately (see adapter/contentMap.ts) so the PFY identity of an
 * activity is its own uuid and nothing else. `legacy_h5p_*` are the migration
 * bookkeeping columns pfy-platform already declares — they record where the
 * activity came from in WordPress, not how to run it now.
 */
export interface ActivityRef {
  uuid: string;
  /** 'h5p' is one implementation of an activity, alongside PFY-native types. */
  activity_type: string;
  title: string;
  status: 'draft' | 'published';
  behavior: ActivityBehavior;
  legacy_h5p_content_id: number | null;
  legacy_h5p_library_name: string | null;
}

// ─── Attempt / Result ────────────────────────────────────────────────────────

/**
 * One learner engagement with one activity.
 *
 * pfy-platform persists Attempt and Result as a single append-only
 * `activity_attempts` row. They are modelled here as two views over that row
 * because they answer different questions ("did they try?" vs "how did it go?")
 * and because the Result half is frequently absent — 27% of PFY's legacy H5P
 * content cannot emit a score at all.
 */
export interface Attempt {
  uuid: string;
  /** PFY activity uuid. Never a runtime/Lumi identifier. */
  activity_id: string;
  user_id: string;
  session_id: string | null;
  /** 1-based, monotonic per (user, activity). Never reused, never rewritten. */
  attempt_number: number;
  started_at: string;
  completed_at: string | null;
}

export interface Result {
  attempt_uuid: string;
  /** null when the activity reports no score (e.g. Accordion, ImageSlider). */
  score_raw: number | null;
  score_max: number | null;
  score_min: number;
  /** 0–1, derived; null when unscored. */
  score_scaled: number | null;
  /** 0–1, from the activity's own pass criterion when it has one. */
  pass_threshold: number | null;
  is_passed: boolean | null;
  is_completed: boolean;
  duration_seconds: number | null;
  verb: Verb | null;
  score_provenance: ScoreProvenance;
}

/** The persisted shape: one append-only row carrying both views. */
export type AttemptRecord = Attempt & Omit<Result, 'attempt_uuid'>;

/** What a normalizer produces before it is written to an attempt row. */
export type ScoredOutcome = Omit<Result, 'attempt_uuid'>;

// ─── Derivations ─────────────────────────────────────────────────────────────

/**
 * score_scaled per the xAPI definition: (raw - min) / (max - min), clamped to
 * 0–1. Returns null when the activity did not supply a usable score range,
 * which is a legitimate outcome rather than a zero.
 */
export function computeScoreScaled(
  raw: number | null,
  max: number | null,
  min = 0
): number | null {
  if (raw === null || max === null) return null;
  const span = max - min;
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, (raw - min) / span));
}

/** null when there is nothing to judge (no score, or no pass criterion). */
export function computeIsPassed(
  scaled: number | null,
  passThreshold: number | null
): boolean | null {
  if (scaled === null || passThreshold === null) return null;
  return scaled >= passThreshold;
}

/**
 * Verb selection, mirroring how pfy-platform's scorers classify an outcome:
 * an unscored-but-finished engagement is 'completed', a scored one resolves to
 * 'passed'/'failed', and anything still in flight is 'answered'.
 */
export function computeVerb(
  isCompleted: boolean,
  isPassed: boolean | null
): Verb {
  if (!isCompleted) return 'answered';
  if (isPassed === null) return 'completed';
  return isPassed ? 'passed' : 'failed';
}

// ─── Schemas ─────────────────────────────────────────────────────────────────

export const activityBehaviorSchema = z.object({
  allow_retry: z.boolean(),
  allow_show_solution: z.boolean(),
  pass_percentage: z.number().min(0).max(100),
  randomize_answers: z.boolean().optional(),
  max_attempts: z.number().int().positive().nullable()
});

export const activityRefSchema = z.object({
  uuid: z.string().uuid(),
  activity_type: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['draft', 'published']),
  behavior: activityBehaviorSchema,
  legacy_h5p_content_id: z.number().int().nullable(),
  legacy_h5p_library_name: z.string().nullable()
});

export const attemptSchema = z.object({
  uuid: z.string().uuid(),
  activity_id: z.string().uuid(),
  user_id: z.string().min(1),
  session_id: z.string().max(64).nullable(),
  attempt_number: z.number().int().positive(),
  started_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable()
});

export const scoredOutcomeSchema = z.object({
  score_raw: z.number().nullable(),
  score_max: z.number().nullable(),
  score_min: z.number(),
  score_scaled: z.number().min(0).max(1).nullable(),
  pass_threshold: z.number().min(0).max(1).nullable(),
  is_passed: z.boolean().nullable(),
  is_completed: z.boolean(),
  duration_seconds: z.number().int().nonnegative().nullable(),
  verb: z.enum(VERBS).nullable(),
  score_provenance: z.enum(SCORE_PROVENANCE)
});

export const resultSchema = scoredOutcomeSchema.extend({
  attempt_uuid: z.string().uuid()
});
