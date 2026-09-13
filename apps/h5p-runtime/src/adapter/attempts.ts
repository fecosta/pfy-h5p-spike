import crypto from 'crypto';

import type { Attempt, AttemptRecord, ScoredOutcome } from '@spike/learning-contract';

import { db, inImmediateTransaction, nowIso } from '../db';
import { getActivity } from './contentMap';

export interface StartedAttempt {
  attempt: Attempt;
  /** Handed to the browser instead of the attempt uuid. */
  token: string;
}

function rowToRecord(row: Record<string, any>): AttemptRecord {
  return {
    uuid: row.uuid,
    activity_id: row.activity_id,
    user_id: row.user_id,
    session_id: row.session_id ?? null,
    attempt_number: row.attempt_number,
    started_at: row.started_at,
    completed_at: row.completed_at ?? null,
    score_raw: row.score_raw ?? null,
    score_max: row.score_max ?? null,
    score_min: row.score_min ?? 0,
    score_scaled: row.score_scaled ?? null,
    pass_threshold: row.pass_threshold ?? null,
    is_passed:
      row.is_passed === null || row.is_passed === undefined
        ? null
        : Boolean(row.is_passed),
    is_completed: Boolean(row.is_completed),
    duration_seconds: row.duration_seconds ?? null,
    verb: row.verb ?? null,
    score_provenance: row.score_provenance
  };
}

/**
 * Starts a new attempt.
 *
 * Mirrors pfy-platform's AttemptRecorder: attempt_number is last + 1, computed
 * inside an immediate transaction so two concurrent starts cannot claim the
 * same number (Laravel uses lockForUpdate for the same reason). Rows are
 * append-only — starting an attempt never touches an earlier one.
 */
export function startAttempt(
  activityUuid: string,
  userId: string,
  sessionId: string | null = null
): StartedAttempt {
  const activity = getActivity(activityUuid);
  if (!activity) {
    throw new Error(`unknown activity: ${activityUuid}`);
  }

  const passThreshold = activity.behavior.pass_percentage / 100;

  return inImmediateTransaction(() => {
    const conn = db();
    const last = conn
      .prepare(
        `SELECT MAX(attempt_number) AS n
           FROM activity_attempts
          WHERE activity_id = ? AND user_id = ?`
      )
      .get(activityUuid, userId) as { n?: number | null };

    const attemptNumber = (last?.n ?? 0) + 1;
    const uuid = crypto.randomUUID();
    const startedAt = nowIso();

    conn
      .prepare(
        `INSERT INTO activity_attempts
           (uuid, activity_id, user_id, session_id, attempt_number,
            score_min, pass_threshold, is_completed, score_provenance, started_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, 'client_reported', ?)`
      )
      .run(uuid, activityUuid, userId, sessionId, attemptNumber, passThreshold, startedAt);

    const token = crypto.randomBytes(24).toString('base64url');
    conn
      .prepare(
        'INSERT INTO attempt_tokens (token, attempt_uuid, issued_at) VALUES (?, ?, ?)'
      )
      .run(token, uuid, startedAt);

    return {
      token,
      attempt: {
        uuid,
        activity_id: activityUuid,
        user_id: userId,
        session_id: sessionId,
        attempt_number: attemptNumber,
        started_at: startedAt,
        completed_at: null
      }
    };
  });
}

export function resolveToken(token: string): AttemptRecord | null {
  const row = db()
    .prepare(
      `SELECT a.* FROM attempt_tokens t
         JOIN activity_attempts a ON a.uuid = t.attempt_uuid
        WHERE t.token = ?`
    )
    .get(token) as Record<string, any> | undefined;
  return row ? rowToRecord(row) : null;
}

export function getAttempt(uuid: string): AttemptRecord | null {
  const row = db()
    .prepare('SELECT * FROM activity_attempts WHERE uuid = ?')
    .get(uuid) as Record<string, any> | undefined;
  return row ? rowToRecord(row) : null;
}

export function listAttempts(
  activityUuid: string,
  userId?: string
): AttemptRecord[] {
  const rows = userId
    ? db()
        .prepare(
          `SELECT * FROM activity_attempts
            WHERE activity_id = ? AND user_id = ?
            ORDER BY attempt_number ASC`
        )
        .all(activityUuid, userId)
    : db()
        .prepare(
          `SELECT * FROM activity_attempts
            WHERE activity_id = ?
            ORDER BY attempt_number ASC`
        )
        .all(activityUuid);
  return (rows as Array<Record<string, any>>).map(rowToRecord);
}

export type ApplyResult =
  | { status: 'recorded'; attempt: AttemptRecord }
  | { status: 'duplicate_ignored'; attempt: AttemptRecord; reason: string };

/**
 * Attaches a result to an attempt.
 *
 * Idempotent on purpose. A page reload re-attaches the same H5P instance, which
 * can re-emit a completion statement for work the learner already finished; and
 * H5P's own offline queue retries failed posts. Once an attempt is completed,
 * its result is frozen — a genuinely new engagement has to start a new attempt,
 * which is what keeps attempt history honest.
 */
export function applyOutcome(
  attemptUuid: string,
  outcome: ScoredOutcome
): ApplyResult {
  return inImmediateTransaction(() => {
    const current = getAttempt(attemptUuid);
    if (!current) throw new Error(`unknown attempt: ${attemptUuid}`);

    if (current.is_completed) {
      return {
        status: 'duplicate_ignored' as const,
        attempt: current,
        reason:
          'attempt already completed; results are append-only and never overwritten'
      };
    }

    const completedAt = outcome.is_completed ? nowIso() : null;

    // Duration: prefer what the activity reported, else measure the attempt.
    const durationSeconds =
      outcome.duration_seconds ??
      (completedAt
        ? Math.max(
            0,
            Math.round(
              (Date.parse(completedAt) - Date.parse(current.started_at)) / 1000
            )
          )
        : null);

    db()
      .prepare(
        `UPDATE activity_attempts
            SET score_raw = ?, score_max = ?, score_min = ?, score_scaled = ?,
                pass_threshold = ?, is_passed = ?, is_completed = ?,
                duration_seconds = ?, verb = ?, score_provenance = ?,
                completed_at = ?
          WHERE uuid = ?`
      )
      .run(
        outcome.score_raw,
        outcome.score_max,
        outcome.score_min,
        outcome.score_scaled,
        outcome.pass_threshold,
        outcome.is_passed === null ? null : outcome.is_passed ? 1 : 0,
        outcome.is_completed ? 1 : 0,
        durationSeconds,
        outcome.verb,
        outcome.score_provenance,
        completedAt,
        attemptUuid
      );

    return { status: 'recorded' as const, attempt: getAttempt(attemptUuid)! };
  });
}

// ─── Debug retention ────────────────────────────────────────────────────────

export function recordRawStatement(input: {
  attemptUuid: string | null;
  verb: string | null;
  topLevel: boolean;
  accepted: boolean;
  reason: string | null;
  statement: unknown;
}): void {
  db()
    .prepare(
      `INSERT INTO h5p_xapi_raw
         (attempt_uuid, verb, top_level, accepted, reason, statement, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.attemptUuid,
      input.verb,
      input.topLevel ? 1 : 0,
      input.accepted ? 1 : 0,
      input.reason,
      JSON.stringify(input.statement),
      nowIso()
    );
}

export function recordRawFinished(input: {
  attemptUuid: string | null;
  h5pContentId: string | null;
  score: number | null;
  maxScore: number | null;
  opened: number | null;
  finished: number | null;
  time: number | null;
}): void {
  db()
    .prepare(
      `INSERT INTO h5p_finished_raw
         (attempt_uuid, h5p_content_id, score, max_score, opened, finished, time, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.attemptUuid,
      input.h5pContentId,
      input.score,
      input.maxScore,
      input.opened,
      input.finished,
      input.time,
      nowIso()
    );
}

/** The newest attempt for (user, activity) that has not been completed yet. */
export function findOpenAttempt(
  activityUuid: string,
  userId: string
): AttemptRecord | null {
  const row = db()
    .prepare(
      `SELECT * FROM activity_attempts
        WHERE activity_id = ? AND user_id = ? AND is_completed = 0
        ORDER BY attempt_number DESC LIMIT 1`
    )
    .get(activityUuid, userId) as Record<string, any> | undefined;
  return row ? rowToRecord(row) : null;
}
