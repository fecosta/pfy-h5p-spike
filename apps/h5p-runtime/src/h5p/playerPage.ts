import type * as H5P from '@lumieducation/h5p-server';
import type { ActivityRef, AttemptRecord } from '@spike/learning-contract';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The play page.
 *
 * Two things are added to what Lumi's integration object provides:
 *
 *  1. An xAPI listener. There is no server-side xAPI endpoint in h5p-server at
 *     all, so the browser is the only place statements exist. The listener is
 *     registered before H5P.init runs (H5P core initialises on document ready),
 *     otherwise statements emitted during initialisation would be missed.
 *
 *  2. An attempt token appended to H5PIntegration.ajax.setFinished. Lumi's
 *     completion POST carries only (contentId, score, maxScore, opened,
 *     finished, time) — no contextId, no attempt id — so out of the box the
 *     server cannot tell which attempt a completion belongs to. Appending the
 *     token to our own page's integration object closes that gap without
 *     patching the library.
 */
export function renderPlayerPage(
  model: H5P.IPlayerModel,
  ctx: {
    activity: ActivityRef;
    attempt: AttemptRecord;
    attemptToken: string;
    apiBase: string;
  }
): string {
  const integration = JSON.stringify(model.integration, null, 2);

  return `<!doctype html>
<html class="h5p-iframe" lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ctx.activity.title)}</title>
${model.styles.map((s) => `<link rel="stylesheet" href="${s}"/>`).join('\n')}
<style>
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; }
  .spike-bar { padding: 8px 12px; background: #f3f4f6; border-bottom: 1px solid #d1d5db;
               display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
  .spike-bar code { background: #fff; padding: 1px 5px; border: 1px solid #e5e7eb; }
  .spike-log { margin: 0; padding: 8px 12px; background: #111827; color: #d1fae5;
               font-family: ui-monospace, monospace; font-size: 12px;
               max-height: 160px; overflow: auto; white-space: pre-wrap; }
  .h5p-content { border: 0; }
</style>
${model.scripts.map((s) => `<script src="${s}"></script>`).join('\n')}
<script>
  window.H5PIntegration = ${integration};
</script>
<script>
  (function () {
    var TOKEN = ${JSON.stringify(ctx.attemptToken)};
    var API = ${JSON.stringify(ctx.apiBase)};

    // --- (2) attribute Lumi's completion POST to this attempt ---------------
    try {
      var url = window.H5PIntegration.ajax.setFinished;
      window.H5PIntegration.ajax.setFinished =
        url + (url.indexOf('?') === -1 ? '?' : '&') + 'attemptToken=' + encodeURIComponent(TOKEN);
    } catch (e) {
      console.error('[spike] could not tag setFinished url', e);
    }

    function log(line) {
      var el = document.getElementById('spike-log');
      if (el) { el.textContent += line + '\\n'; el.scrollTop = el.scrollHeight; }
    }

    function post(path, body) {
      return fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); });
    }

    // --- (1) capture xAPI before H5P.init ----------------------------------
    function attach() {
      if (!window.H5P || !window.H5P.externalDispatcher) return false;
      window.H5P.externalDispatcher.on('xAPI', function (event) {
        var statement = event && event.data && event.data.statement;
        if (!statement) return;
        var verb = (statement.verb && statement.verb.id) || '(no verb)';
        var hasParent = !!(statement.context && statement.context.contextActivities
                           && statement.context.contextActivities.parent);
        log('xAPI ' + verb.split('/').pop() + (hasParent ? ' [sub-content]' : ' [top-level]'));
        post('/api/xapi', { token: TOKEN, statement: statement })
          .then(function (res) {
            if (res && res.status) {
              log('  -> ' + res.status + (res.reason ? ': ' + res.reason : ''));
              document.body.setAttribute('data-spike-last-status', res.status);
            }
          })
          .catch(function (err) { log('  -> POST failed: ' + err); });
      });
      return true;
    }

    if (!attach()) {
      document.addEventListener('DOMContentLoaded', attach);
    }
  })();
</script>
</head>
<body data-spike-attempt="${escapeHtml(ctx.attempt.uuid)}"
      data-spike-attempt-number="${ctx.attempt.attempt_number}">
<div class="spike-bar">
  <strong data-testid="activity-title">${escapeHtml(ctx.activity.title)}</strong>
  <span>activity <code data-testid="activity-uuid">${escapeHtml(ctx.activity.uuid)}</code></span>
  <span>attempt <code data-testid="attempt-number">#${ctx.attempt.attempt_number}</code></span>
  <a data-testid="new-attempt" href="?newAttempt=1">start new attempt</a>
  <a data-testid="reload" href="">reload this attempt</a>
</div>
<div class="h5p-content" data-content-id="${model.contentId}"></div>
<pre class="spike-log" id="spike-log" data-testid="spike-log"></pre>
</body>
</html>`;
}
