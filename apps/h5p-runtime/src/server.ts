import cors from 'cors';
import express from 'express';
import fileUpload from 'express-fileupload';

import {
  h5pAjaxExpressRouter,
  libraryAdministrationExpressRouter
} from '@lumieducation/h5p-express';

import * as attempts from './adapter/attempts';
import { forgetContent, syncFromEditor, toActivityUuid } from './adapter/contentMap';
import { createApiRouter } from './api/routes';
import { db } from './db';
import { createH5PRuntime, scheduleTemporaryFileCleanup } from './h5p/createH5PEditor';
import { createPageRouter } from './h5p/routes';
import { AUTHOR_USER } from './h5p/user';
import { PORT, WEB_ORIGIN, paths } from './paths';

async function main(): Promise<void> {
  db(); // initialise schema before anything can write

  const runtime = await createH5PRuntime({
    // Content created or changed in the H5P editor gets its id from Lumi, so
    // the PFY mapping is established here rather than by the caller.
    created: async (contentId, metadata, params) => {
      syncFromEditor(
        contentId,
        metadata.title,
        metadata.mainLibrary,
        params
      );
      console.log(`[adapter] content created -> activity registered (${contentId})`);
    },
    updated: async (contentId, metadata, params) => {
      syncFromEditor(contentId, metadata.title, metadata.mainLibrary, params);
      console.log(`[adapter] content updated (${contentId})`);
    },
    deleted: async (contentId) => {
      forgetContent(contentId);
    }
  });

  const app = express();
  const config = runtime.config;

  // apps/web is a different origin on purpose; the spike needs to observe real
  // cross-origin behaviour rather than hide it behind a dev proxy.
  app.use(
    cors({
      origin: [WEB_ORIGIN],
      credentials: true
    })
  );

  app.use(express.json({ limit: '500mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    fileUpload({
      limits: { fileSize: config.maxTotalSize },
      // File sanitizers in 10.0.4 only run on temp FILES, not in-memory
      // buffers, so temp files are required for the SVG sanitizer to apply.
      useTempFiles: true,
      tempFileDir: paths.temp
    })
  );

  // h5p-express requires both of these on the request object.
  app.use((req, _res, next) => {
    (req as any).user = AUTHOR_USER;
    // Minimal translation function: the adapter surfaces error ids as-is.
    (req as any).t = (key: string) => key;
    (req as any).language = 'pt-BR';
    next();
  });

  /**
   * Completion interceptor.
   *
   * Lumi's completion POST (config.setFinishedUrl) carries only contentId,
   * score, maxScore, opened, finished and time — there is no contextId or
   * attempt id in the payload or the interface, so out of the box the server
   * cannot tell which attempt completed. The play page appends the attempt
   * token to this URL, which is read here; if it is absent we fall back to the
   * newest open attempt for that content. The request then continues to Lumi's
   * own handler untouched.
   */
  app.post(`${config.baseUrl}${config.setFinishedUrl}`, (req, _res, next) => {
    try {
      const token =
        typeof req.query.attemptToken === 'string' ? req.query.attemptToken : null;
      const contentId =
        req.body?.contentId !== undefined ? String(req.body.contentId) : null;

      let attempt = token ? attempts.resolveToken(token) : null;
      if (!attempt && contentId) {
        const activityUuid = toActivityUuid(contentId);
        if (activityUuid) {
          attempt = attempts.findOpenAttempt(activityUuid, (req as any).user.id);
        }
      }

      const num = (value: unknown): number | null =>
        value === undefined || value === null || value === '' ? null : Number(value);

      attempts.recordRawFinished({
        attemptUuid: attempt?.uuid ?? null,
        h5pContentId: contentId,
        score: num(req.body?.score),
        maxScore: num(req.body?.maxScore),
        opened: num(req.body?.opened),
        finished: num(req.body?.finished),
        time: num(req.body?.time)
      });
    } catch (error) {
      console.error('[adapter] finishedData interceptor failed:', error);
    }
    next();
  });

  // Mounted at config.baseUrl: the router registers its routes relative to the
  // mount point (/libraries, /content, /ajax...) while UrlGenerator emits them
  // prefixed with baseUrl. Mounting at root makes every asset 404.
  app.use(
    config.baseUrl,
    h5pAjaxExpressRouter(runtime.editor, paths.core, paths.editor, undefined, 'pt-BR')
  );

  /**
   * Library administration is NOT mounted by default.
   *
   * These routes install, restrict and delete libraries, and the router itself
   * performs no authentication — installing a library ships third-party
   * JavaScript to every learner. Opt in explicitly when exercising it.
   */
  if (process.env.SPIKE_ENABLE_LIBRARY_ADMIN === '1') {
    console.warn(
      '[security] library administration routes are ENABLED (unauthenticated)'
    );
    app.use(
      `${config.baseUrl}/libraries-admin`,
      libraryAdministrationExpressRouter(runtime.editor)
    );
  }

  app.use('/api', createApiRouter(runtime));
  app.use(createPageRouter(runtime));

  app.use(
    (
      error: any,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('[error]', error?.message ?? error);
      const status = typeof error?.httpStatusCode === 'number' ? error.httpStatusCode : 500;
      res.status(status).json({
        error: error?.message ?? 'unknown error',
        errorId: error?.errorId
      });
    }
  );

  scheduleTemporaryFileCleanup(runtime.editor);

  app.listen(PORT, () => {
    console.log(`[runtime] http://localhost:${PORT}`);
    console.log(
      `[runtime] H5P core ${config.h5pVersion}, coreApi ${config.coreApiVersion.major}.${config.coreApiVersion.minor}`
    );
    console.log(`[runtime] content: ${paths.content}`);
    console.log(`[runtime] libraries: ${paths.libraries}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
