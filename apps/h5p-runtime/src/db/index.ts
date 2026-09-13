import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

import { paths } from '../paths';

/**
 * node:sqlite (Node 22) so the spike has no native build step.
 *
 * The schema is a deliberate mirror of pfy-platform's real tables
 * (apps/api/database/migrations/*_create_activity_tables.php) so that anything
 * proven here maps 1:1 onto production. Two tables are additions that exist
 * only inside the adapter boundary: h5p_content_map (the ONLY place a Lumi
 * content id is stored) and the raw-event debug tables.
 */
const SCHEMA = `
-- ─── PFY domain ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activities (
  uuid                     TEXT PRIMARY KEY,
  title                    TEXT    NOT NULL,
  slug                     TEXT    NOT NULL,
  activity_type            TEXT    NOT NULL,          -- 'h5p' here
  definition               TEXT    NOT NULL,          -- JSON (behavior lives here)
  status                   TEXT    NOT NULL DEFAULT 'draft',
  created_at               TEXT    NOT NULL,
  legacy_h5p_content_id    INTEGER UNIQUE,            -- WordPress H5P content id
  legacy_h5p_library_name  TEXT
);

-- Append-only. Rows are never UPDATEd except to attach the result of the
-- attempt they already represent; a new engagement always inserts a new row.
CREATE TABLE IF NOT EXISTS activity_attempts (
  uuid              TEXT PRIMARY KEY,
  activity_id       TEXT    NOT NULL REFERENCES activities(uuid),
  user_id           TEXT    NOT NULL,
  session_id        TEXT,
  attempt_number    INTEGER NOT NULL,
  score_raw         REAL,
  score_max         REAL,
  score_min         REAL    NOT NULL DEFAULT 0,
  score_scaled      REAL,
  pass_threshold    REAL,
  is_passed         INTEGER,
  is_completed      INTEGER NOT NULL DEFAULT 0,
  duration_seconds  INTEGER,
  verb              TEXT,
  score_provenance  TEXT    NOT NULL DEFAULT 'client_reported',
  response_data     TEXT,
  started_at        TEXT    NOT NULL,
  completed_at      TEXT,
  UNIQUE (activity_id, user_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_attempts_user_activity
  ON activity_attempts (user_id, activity_id);

-- ─── Adapter-private (never leaves the boundary) ───────────────────────────
CREATE TABLE IF NOT EXISTS h5p_content_map (
  activity_uuid    TEXT PRIMARY KEY REFERENCES activities(uuid),
  h5p_content_id   TEXT NOT NULL UNIQUE,
  main_library     TEXT NOT NULL,
  source_package   TEXT,
  imported_at      TEXT NOT NULL
);

-- Attempt tokens: the player page is handed a token, not an attempt id, so a
-- client cannot post results for an arbitrary attempt by guessing a uuid.
CREATE TABLE IF NOT EXISTS attempt_tokens (
  token         TEXT PRIMARY KEY,
  attempt_uuid  TEXT NOT NULL REFERENCES activity_attempts(uuid),
  issued_at     TEXT NOT NULL
);

-- ─── Debug retention (raw payloads, per the brief's "optional") ────────────
CREATE TABLE IF NOT EXISTS h5p_xapi_raw (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_uuid  TEXT,
  verb          TEXT,
  top_level     INTEGER,
  accepted      INTEGER NOT NULL,
  reason        TEXT,
  statement     TEXT NOT NULL,
  received_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS h5p_finished_raw (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_uuid    TEXT,
  h5p_content_id  TEXT,
  score           REAL,
  max_score       REAL,
  opened          INTEGER,
  finished        INTEGER,
  time            INTEGER,
  received_at     TEXT NOT NULL
);

-- ─── Spike measurement output ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_probe (
  package         TEXT PRIMARY KEY,
  main_library    TEXT,
  ok              INTEGER NOT NULL,
  h5p_content_id  TEXT,
  libraries_new   INTEGER,
  libraries_patch INTEGER,
  libraries_none  INTEGER,
  duration_ms     INTEGER,
  error_kind      TEXT,
  error_message   TEXT,
  ran_at          TEXT NOT NULL
);
`;

let handle: DatabaseSync | undefined;

export function db(): DatabaseSync {
  if (!handle) {
    fs.mkdirSync(path.dirname(paths.db), { recursive: true });
    handle = new DatabaseSync(paths.db);
    handle.exec('PRAGMA journal_mode = WAL;');
    handle.exec('PRAGMA foreign_keys = ON;');
    handle.exec(SCHEMA);
  }
  return handle;
}

/** BEGIN IMMEDIATE is how we emulate Laravel's lockForUpdate on attempt_number. */
export function inImmediateTransaction<T>(fn: () => T): T {
  const conn = db();
  conn.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    conn.exec('COMMIT;');
    return result;
  } catch (error) {
    conn.exec('ROLLBACK;');
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
