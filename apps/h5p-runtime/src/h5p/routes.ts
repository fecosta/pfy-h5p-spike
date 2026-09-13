import { Router } from 'express';

import * as attempts from '../adapter/attempts';
import { getActivity, listActivities, toActivityUuid, toH5PContentId } from '../adapter/contentMap';
import type { H5PRuntime } from './createH5PEditor';
import { renderPlayerPage } from './playerPage';
import { AUTHOR_USER, LEARNER_USER } from './user';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Pages served by the runtime itself.
 *
 * The editor pages use Lumi's own default renderer (h5pEditor.render returns a
 * complete page, including the form and #save-h5p button). That renderer POSTs
 * `{library, params:{params,metadata}}` back to the same URL and expects a JSON
 * *string* body containing `contentId`, which is why the save handlers use
 * res.send(JSON.stringify(...)) rather than res.json().
 */
export function createPageRouter(runtime: H5PRuntime): Router {
  const router = Router();
  const { editor, player, config } = runtime;

  // ─── Index: minimal operator view over the PFY domain ────────────────────
  router.get('/', (_req, res) => {
    const rows = listActivities();
    res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PFY H5P spike runtime</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;margin:24px;max-width:1100px}
 table{border-collapse:collapse;width:100%} th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
 th{background:#f3f4f6} code{font-size:12px} .muted{color:#6b7280}
</style></head><body>
<h1>PFY H5P spike runtime</h1>
<p class="muted">H5P core ${escapeHtml(config.h5pVersion)} &middot; coreApi
 ${config.coreApiVersion.major}.${config.coreApiVersion.minor} &middot;
 ${rows.length} activit${rows.length === 1 ? 'y' : 'ies'}</p>
<p><a href="${config.baseUrl}/new" data-testid="create-new">Create new activity</a></p>
<table><thead><tr>
  <th>PFY activity uuid</th><th>Title</th><th>Main library</th>
  <th>Legacy WP id</th><th>Actions</th>
</tr></thead><tbody>
${rows
  .map(
    (row) => `<tr data-testid="activity-row" data-activity="${escapeHtml(row.uuid)}">
  <td><code>${escapeHtml(row.uuid)}</code></td>
  <td>${escapeHtml(row.title)}</td>
  <td><code>${escapeHtml(row.legacy_h5p_library_name ?? '')}</code></td>
  <td>${row.legacy_h5p_content_id ?? '<span class="muted">—</span>'}</td>
  <td>
    <a href="/play/${escapeHtml(row.uuid)}">play</a> &middot;
    <a href="/author/${escapeHtml(row.uuid)}">edit</a> &middot;
    <a href="${config.baseUrl}${config.downloadUrl}/${escapeHtml(row.h5p_content_id)}">export .h5p</a> &middot;
    <a href="/api/activities/${escapeHtml(row.uuid)}/attempts">attempts</a>
  </td></tr>`
  )
  .join('\n')}
</tbody></table>
</body></html>`);
  });

  // ─── PFY-facing play page, addressed by ACTIVITY uuid ────────────────────
  //
  // Attempt handling is explicit in the URL: the first request allocates an
  // attempt and redirects to ?t=<token>, so a reload of that URL is the same
  // attempt (and therefore cannot manufacture a second completion), while
  // ?newAttempt=1 deliberately starts a fresh one.
  router.get('/play/:activityUuid', async (req, res, next) => {
    try {
      const activity = getActivity(req.params.activityUuid);
      if (!activity) {
        res.status(404).send('unknown activity');
        return;
      }
      const contentId = toH5PContentId(activity.uuid);
      if (!contentId) {
        res.status(409).send('activity has no H5P content mapped');
        return;
      }

      const token = typeof req.query.t === 'string' ? req.query.t : null;
      const wantsNew = req.query.newAttempt !== undefined;
      const userId =
        typeof req.query.user_id === 'string' ? req.query.user_id : LEARNER_USER.id;

      if (!token || wantsNew) {
        const started = attempts.startAttempt(activity.uuid, userId, null);
        res.redirect(
          302,
          `/play/${activity.uuid}?t=${encodeURIComponent(started.token)}`
        );
        return;
      }

      const attempt = attempts.resolveToken(token);
      if (!attempt || attempt.activity_id !== activity.uuid) {
        res.redirect(302, `/play/${activity.uuid}`);
        return;
      }

      const model = await player.render(contentId, LEARNER_USER, 'pt-BR', {
        showCopyButton: false,
        showDownloadButton: true,
        showFrame: true,
        showH5PIcon: true,
        showLicenseButton: true,
        // One user-state bucket per attempt, so attempt 2 does not resume
        // attempt 1's answers.
        contextId: attempt.uuid
      });

      res.send(
        renderPlayerPage(model as any, {
          activity,
          attempt,
          attemptToken: token,
          apiBase: ''
        })
      );
    } catch (error) {
      next(error);
    }
  });

  /** Convenience: author by PFY identity rather than Lumi identity. */
  router.get('/author/:activityUuid', (req, res) => {
    const contentId = toH5PContentId(req.params.activityUuid);
    if (!contentId) {
      res.status(404).send('unknown activity');
      return;
    }
    res.redirect(302, `${config.baseUrl}/edit/${contentId}`);
  });

  // ─── Lumi-addressed routes (content id), used by Lumi's own redirects ────

  router.get(`${config.baseUrl}${config.playUrl}/:contentId`, (req, res) => {
    const activityUuid = toActivityUuid(req.params.contentId);
    if (!activityUuid) {
      res.status(404).send('unknown content');
      return;
    }
    res.redirect(302, `/play/${activityUuid}`);
  });

  router.get(`${config.baseUrl}/new`, async (req, res, next) => {
    try {
      const page = await editor.render(
        undefined as unknown as string,
        'pt-BR',
        (req as any).user ?? AUTHOR_USER
      );
      res.send(page);
    } catch (error) {
      next(error);
    }
  });

  router.post(`${config.baseUrl}/new`, async (req, res, next) => {
    try {
      const contentId = await editor.saveOrUpdateContent(
        undefined as unknown as string,
        req.body.params.params,
        req.body.params.metadata,
        req.body.library,
        (req as any).user ?? AUTHOR_USER
      );
      res.send(JSON.stringify({ contentId: String(contentId) }));
    } catch (error) {
      next(error);
    }
  });

  router.get(`${config.baseUrl}/edit/:contentId`, async (req, res, next) => {
    try {
      const page = await editor.render(
        req.params.contentId,
        'pt-BR',
        (req as any).user ?? AUTHOR_USER
      );
      res.send(page);
    } catch (error) {
      next(error);
    }
  });

  router.post(`${config.baseUrl}/edit/:contentId`, async (req, res, next) => {
    try {
      const contentId = await editor.saveOrUpdateContent(
        req.params.contentId,
        req.body.params.params,
        req.body.params.metadata,
        req.body.library,
        (req as any).user ?? AUTHOR_USER
      );
      res.send(JSON.stringify({ contentId: String(contentId) }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
