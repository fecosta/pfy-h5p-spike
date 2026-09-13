import { Router } from 'express';

import type { H5PRuntime } from '../h5p/createH5PEditor';
import { importPackage } from '../adapter/import';
import { AUTHOR_USER, LEARNER_USER } from '../h5p/user';
import { db } from '../db';
import * as attempts from '../adapter/attempts';
import {
  deleteActivity,
  getActivity,
  listActivities,
  toH5PContentId
} from '../adapter/contentMap';
import { normalizeStatement, type XapiStatement } from '../adapter/xapi';

/** The origin this runtime is reachable at, as seen by the requesting page. */
function runtimeOrigin(req: { protocol: string; get: (h: string) => string | undefined }): string {
  return process.env.PUBLIC_RUNTIME_URL ?? `${req.protocol}://${req.get('host')}`;
}

/**
 * The PFY-facing API.
 *
 * Every response here speaks the PFY contract: activity uuids, attempts and
 * results. No route returns a Lumi content id, a library ubername or a
 * filesystem path — except the two editor/player *model* routes, which exist
 * purely to feed Lumi's own web components and are labelled as such.
 */

/**
 * Lumi generates every asset and ajax URL relative to config.baseUrl
 * ("/h5p/core/js/h5p.js", "/h5p/finishedData", ...). That is correct for pages
 * the runtime serves itself, but a page on another origin — the Next.js app on
 * :3000 — would resolve them against ITS origin and get 404s for the entire
 * H5P core.
 *
 * There is no configuration for this: setting config.baseUrl to an absolute URL
 * would also change where the routers mount. So the model is rewritten on the
 * way out, and only for the embed routes.
 */
function toAbsoluteUrls<T>(model: T, origin: string, baseUrl: string): T {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value === baseUrl || value.startsWith(`${baseUrl}/`)
        ? `${origin}${value}`
        : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v)])
      );
    }
    return value;
  };
  return walk(model) as T;
}

export function createApiRouter(runtime: H5PRuntime): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      h5p: {
        coreApiVersion: runtime.config.coreApiVersion,
        h5pVersion: runtime.config.h5pVersion,
        baseUrl: runtime.config.baseUrl,
        hubContentTypesEndpoint: runtime.config.hubContentTypesEndpoint,
        setFinishedEnabled: runtime.config.setFinishedEnabled,
        contentUserStateSaveInterval: runtime.config.contentUserStateSaveInterval,
        maxFileSize: runtime.config.maxFileSize,
        maxTotalSize: runtime.config.maxTotalSize,
        contentWhitelist: runtime.config.contentWhitelist,
        libraryWhitelist: runtime.config.libraryWhitelist
      }
    });
  });

  router.get('/activities', (_req, res) => {
    res.json({ data: listActivities() });
  });

  router.get('/activities/:uuid', (req, res) => {
    const activity = getActivity(req.params.uuid);
    if (!activity) {
      res.status(404).json({ error: 'unknown activity' });
      return;
    }
    res.json({ data: activity });
  });

  /** Removes an activity and the content behind it. Used by probes/tests. */
  router.delete('/activities/:uuid', async (req, res, next) => {
    try {
      const contentId = toH5PContentId(req.params.uuid);
      if (!contentId) {
        res.status(404).json({ error: 'unknown activity' });
        return;
      }
      try {
        await runtime.editor.deleteContent(contentId, AUTHOR_USER);
      } catch {
        // Best effort: the PFY rows go regardless, so a half-deleted runtime
        // cannot leave an orphan activity behind.
      }
      deleteActivity(req.params.uuid);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  /** Starts a new attempt. This is the only way an attempt comes into being. */
  router.post('/activities/:uuid/attempts', (req, res) => {
    const activity = getActivity(req.params.uuid);
    if (!activity) {
      res.status(404).json({ error: 'unknown activity' });
      return;
    }
    const started = attempts.startAttempt(
      activity.uuid,
      req.body?.user_id ?? LEARNER_USER.id,
      req.body?.session_id ?? null
    );
    res.status(201).json({ data: started });
  });

  router.get('/activities/:uuid/attempts', (req, res) => {
    const userId =
      typeof req.query.user_id === 'string' ? req.query.user_id : undefined;
    res.json({ data: attempts.listAttempts(req.params.uuid, userId) });
  });

  router.get('/attempts/:uuid', (req, res) => {
    const attempt = attempts.getAttempt(req.params.uuid);
    if (!attempt) {
      res.status(404).json({ error: 'unknown attempt' });
      return;
    }
    res.json({ data: attempt });
  });

  /**
   * xAPI intake.
   *
   * h5p-server has no xAPI endpoint of any kind — statements only exist in the
   * browser — so this is ours. Statements are accepted against an attempt
   * token rather than an attempt id, so a client cannot post a result onto an
   * arbitrary attempt. Every statement is retained for debugging, including the
   * ones deliberately ignored.
   */
  router.post('/xapi', (req, res) => {
    const token = String(req.body?.token ?? '');
    const statement = req.body?.statement as XapiStatement | undefined;

    const attempt = token ? attempts.resolveToken(token) : null;
    if (!attempt) {
      attempts.recordRawStatement({
        attemptUuid: null,
        verb: statement?.verb?.id ?? null,
        topLevel: false,
        accepted: false,
        reason: 'unknown or missing attempt token',
        statement: statement ?? null
      });
      res.status(401).json({ status: 'rejected', reason: 'unknown attempt token' });
      return;
    }
    if (!statement) {
      res.status(400).json({ status: 'rejected', reason: 'missing statement' });
      return;
    }

    const activity = getActivity(attempt.activity_id);
    const passThreshold =
      attempt.pass_threshold ??
      (activity ? activity.behavior.pass_percentage / 100 : null);

    const normalized = normalizeStatement(statement, passThreshold);

    if (normalized.kind === 'ignored') {
      attempts.recordRawStatement({
        attemptUuid: attempt.uuid,
        verb: normalized.verbId,
        topLevel: false,
        accepted: false,
        reason: normalized.reason,
        statement
      });
      res.json({ status: 'ignored', reason: normalized.reason });
      return;
    }

    const applied = attempts.applyOutcome(attempt.uuid, normalized.outcome);
    attempts.recordRawStatement({
      attemptUuid: attempt.uuid,
      verb: normalized.verbId,
      topLevel: true,
      accepted: applied.status === 'recorded',
      reason: applied.status === 'recorded' ? null : applied.reason,
      statement
    });

    res.json({
      status: applied.status,
      reason: applied.status === 'recorded' ? undefined : applied.reason,
      data: applied.attempt
    });
  });

  /** Raw debug retention, so the spike can show what was ignored and why. */
  router.get('/debug/xapi', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    const rows = db()
      .prepare(
        `SELECT id, attempt_uuid, verb, top_level, accepted, reason, received_at
           FROM h5p_xapi_raw ORDER BY id DESC LIMIT ?`
      )
      .all(limit);
    res.json({ data: rows });
  });

  router.get('/debug/finished', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100), 1000);
    const rows = db()
      .prepare(`SELECT * FROM h5p_finished_raw ORDER BY id DESC LIMIT ?`)
      .all(limit);
    res.json({ data: rows });
  });

  /**
   * Imports an uploaded .h5p package and registers it as a PFY activity.
   *
   * Note what this endpoint implies: importing a package installs the
   * libraries inside it, which means shipping third-party JavaScript to every
   * learner. It is gated on the author role via the permission system, and in
   * production it would need real authentication (see SPIKE_RESULTS.md).
   */
  router.post('/import', async (req, res, next) => {
    try {
      const uploaded = (req as any).files?.h5p;
      if (!uploaded) {
        res.status(400).json({ error: 'expected a file field named "h5p"' });
        return;
      }
      const file = Array.isArray(uploaded) ? uploaded[0] : uploaded;
      if (!file.tempFilePath) {
        res.status(500).json({ error: 'upload middleware did not produce a temp file' });
        return;
      }

      const result = await importPackage(runtime.editor, file.tempFilePath, AUTHOR_USER);
      res.status(201).json({
        data: {
          activity: result.activity,
          main_library: result.mainLibrary,
          libraries_installed: result.installedLibraries.length
        }
      });
    } catch (error: any) {
      if (error?.errorId) {
        res.status(error.httpStatusCode ?? 400).json({
          error: error.message,
          errorId: error.errorId
        });
        return;
      }
      next(error);
    }
  });

  // ─── Model routes for @lumieducation/h5p-webcomponents ───────────────────
  // These necessarily expose Lumi's own model objects: the web components are
  // Lumi components. They are keyed by PFY activity uuid so the browser still
  // never needs to know a content id.

  router.get('/activities/:uuid/player-model', async (req, res, next) => {
    try {
      const contentId = toH5PContentId(req.params.uuid);
      if (!contentId) {
        res.status(404).json({ error: 'unknown activity' });
        return;
      }
      const attemptToken =
        typeof req.query.t === 'string' ? req.query.t : undefined;
      const attempt = attemptToken ? attempts.resolveToken(attemptToken) : null;

      const model = await runtime.player.render(
        contentId,
        LEARNER_USER,
        'pt-BR',
        { contextId: attempt?.uuid }
      );
      res.json(toAbsoluteUrls(model, runtimeOrigin(req), runtime.config.baseUrl));
    } catch (error) {
      next(error);
    }
  });

  router.get('/activities/:uuid/editor-model', async (req, res, next) => {
    try {
      const contentId = toH5PContentId(req.params.uuid);
      if (!contentId) {
        res.status(404).json({ error: 'unknown activity' });
        return;
      }
      const [model, content] = await Promise.all([
        runtime.editorApi.render(contentId, 'pt-BR', (req as any).user),
        runtime.editorApi.getContent(contentId, (req as any).user)
      ]);
      res.json(
        toAbsoluteUrls(
          { ...(model as object), ...content },
          runtimeOrigin(req),
          runtime.config.baseUrl
        )
      );
    } catch (error) {
      next(error);
    }
  });

  /** Editor model for brand-new content (no contentId yet). */
  router.get('/editor-model/new', async (req, res, next) => {
    try {
      const model = await runtime.editorApi.render(
        undefined as unknown as string,
        'pt-BR',
        (req as any).user
      );
      res.json(toAbsoluteUrls(model, runtimeOrigin(req), runtime.config.baseUrl));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
