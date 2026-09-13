import crypto from 'crypto';

import type { ActivityBehavior, ActivityRef } from '@spike/learning-contract';

import { db, nowIso } from '../db';
import { deriveBehavior, slugify } from './mapping';

/**
 * The PFY ⇄ Lumi identity boundary.
 *
 * A PFY activity is identified by its own uuid, forever. The Lumi content id is
 * an implementation detail of the runtime and is stored ONLY in
 * h5p_content_map. Nothing outside this module reads or writes it, so replacing
 * or re-importing the runtime does not change any PFY identifier, and no PFY
 * table, URL or API response ever carries a Lumi id.
 */

export interface RegisterInput {
  title: string;
  mainLibrary: string;
  h5pContentId: string;
  behavior: ActivityBehavior;
  sourcePackage?: string;
  legacyH5pContentId?: number | null;
  status?: 'draft' | 'published';
}

function rowToActivityRef(row: Record<string, any>): ActivityRef {
  return {
    uuid: row.uuid,
    activity_type: row.activity_type,
    title: row.title,
    status: row.status,
    behavior: JSON.parse(row.definition).behavior as ActivityBehavior,
    legacy_h5p_content_id: row.legacy_h5p_content_id ?? null,
    legacy_h5p_library_name: row.legacy_h5p_library_name ?? null
  };
}

export function registerActivity(input: RegisterInput): ActivityRef {
  const conn = db();
  const uuid = crypto.randomUUID();
  const createdAt = nowIso();

  // `definition` is the PFY activity definition envelope. For an H5P activity
  // it records the pedagogical settings PFY owns; it deliberately does NOT
  // contain a Lumi content id or a filesystem path.
  const definition = JSON.stringify({
    schema_version: 1,
    type: 'h5p',
    locale: 'pt-BR',
    behavior: input.behavior
  });

  // A duplicate legacy id means the same WordPress activity was imported twice.
  const legacyId = input.legacyH5pContentId ?? null;
  const legacyTaken =
    legacyId === null
      ? undefined
      : conn
          .prepare('SELECT uuid FROM activities WHERE legacy_h5p_content_id = ?')
          .get(legacyId);

  conn
    .prepare(
      `INSERT INTO activities
         (uuid, title, slug, activity_type, definition, status, created_at,
          legacy_h5p_content_id, legacy_h5p_library_name)
       VALUES (?, ?, ?, 'h5p', ?, ?, ?, ?, ?)`
    )
    .run(
      uuid,
      input.title,
      `${slugify(input.title)}-${uuid.slice(0, 8)}`,
      definition,
      input.status ?? 'published',
      createdAt,
      legacyTaken ? null : legacyId,
      input.mainLibrary
    );

  conn
    .prepare(
      `INSERT INTO h5p_content_map
         (activity_uuid, h5p_content_id, main_library, source_package, imported_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      uuid,
      String(input.h5pContentId),
      input.mainLibrary,
      input.sourcePackage ?? null,
      createdAt
    );

  return rowToActivityRef(
    conn.prepare('SELECT * FROM activities WHERE uuid = ?').get(uuid) as Record<
      string,
      any
    >
  );
}

/** Resolves a PFY activity to the runtime content it is backed by. */
export function toH5PContentId(activityUuid: string): string | null {
  const row = db()
    .prepare('SELECT h5p_content_id FROM h5p_content_map WHERE activity_uuid = ?')
    .get(activityUuid) as { h5p_content_id?: string } | undefined;
  return row?.h5p_content_id ?? null;
}

/** Reverse lookup, used only when Lumi tells us about an id (editor hooks). */
export function toActivityUuid(h5pContentId: string): string | null {
  const row = db()
    .prepare('SELECT activity_uuid FROM h5p_content_map WHERE h5p_content_id = ?')
    .get(String(h5pContentId)) as { activity_uuid?: string } | undefined;
  return row?.activity_uuid ?? null;
}

export function getActivity(activityUuid: string): ActivityRef | null {
  const row = db()
    .prepare('SELECT * FROM activities WHERE uuid = ?')
    .get(activityUuid) as Record<string, any> | undefined;
  return row ? rowToActivityRef(row) : null;
}

export function listActivities(): Array<
  ActivityRef & { h5p_content_id: string; source_package: string | null }
> {
  return (
    db()
      .prepare(
        `SELECT a.*, m.h5p_content_id, m.source_package
           FROM activities a
           JOIN h5p_content_map m ON m.activity_uuid = a.uuid
          ORDER BY a.created_at DESC`
      )
      .all() as Array<Record<string, any>>
  ).map((row) => ({
    ...rowToActivityRef(row),
    h5p_content_id: row.h5p_content_id,
    source_package: row.source_package ?? null
  }));
}

/**
 * Called from Lumi's contentWasCreated / contentWasUpdated hooks.
 *
 * Content created in the H5P editor gets its id from Lumi, so the mapping has
 * to be established after the fact. An unknown id means a brand-new authoring
 * flow and gets a fresh PFY activity; a known id just refreshes the PFY-owned
 * fields from the saved params.
 */
export function syncFromEditor(
  h5pContentId: string,
  title: string,
  mainLibrary: string,
  params: unknown
): ActivityRef {
  const existingUuid = toActivityUuid(h5pContentId);
  const behavior = deriveBehavior(params);

  if (!existingUuid) {
    return registerActivity({
      title,
      mainLibrary,
      h5pContentId,
      behavior,
      status: 'published'
    });
  }

  const conn = db();
  const definition = JSON.stringify({
    schema_version: 1,
    type: 'h5p',
    locale: 'pt-BR',
    behavior
  });
  conn
    .prepare(
      `UPDATE activities
          SET title = ?, definition = ?, legacy_h5p_library_name = ?
        WHERE uuid = ?`
    )
    .run(title, definition, mainLibrary, existingUuid);

  return getActivity(existingUuid)!;
}

/** Removes a PFY activity and its mapping entirely. Used by cleanup paths. */
export function deleteActivity(activityUuid: string): void {
  const conn = db();
  conn.prepare('DELETE FROM attempt_tokens WHERE attempt_uuid IN (SELECT uuid FROM activity_attempts WHERE activity_id = ?)').run(activityUuid);
  conn.prepare('DELETE FROM activity_attempts WHERE activity_id = ?').run(activityUuid);
  conn.prepare('DELETE FROM h5p_content_map WHERE activity_uuid = ?').run(activityUuid);
  conn.prepare('DELETE FROM activities WHERE uuid = ?').run(activityUuid);
}

export function forgetContent(h5pContentId: string): void {
  const conn = db();
  const uuid = toActivityUuid(h5pContentId);
  if (!uuid) return;
  conn
    .prepare('DELETE FROM h5p_content_map WHERE activity_uuid = ?')
    .run(uuid);
  conn.prepare(`UPDATE activities SET status = 'draft' WHERE uuid = ?`).run(uuid);
}
