/**
 * PFY authoring draft -> real, editable H5P content.
 *
 * This is the Workstream 6 proof: structured (notionally AI-generated) content
 * becomes H5P content that a human author opens in the normal editor and
 * reviews before publication. No LLM is called; the draft fixture stands in for
 * model output so the transform is what gets tested.
 *
 * Usage: npx tsx scripts/create-from-draft.ts [draft.yaml]
 */
import fs from 'fs';
import path from 'path';

import { loadDraftFromYaml, transformDraft } from '@spike/h5p-authoring-draft';

import { deriveBehavior } from '../src/adapter/mapping';
import { registerActivity } from '../src/adapter/contentMap';
import { db } from '../src/db';
import { createH5PRuntime } from '../src/h5p/createH5PEditor';
import { AUTHOR_USER } from '../src/h5p/user';

const DEFAULT_DRAFT = path.resolve(
  __dirname,
  '../../../packages/h5p-authoring-draft/fixtures/por-ou-para.draft.yaml'
);

async function main(): Promise<void> {
  const draftPath = path.resolve(process.argv[2] ?? DEFAULT_DRAFT);
  if (!fs.existsSync(draftPath)) {
    console.error(`draft not found: ${draftPath}`);
    process.exit(1);
  }

  db();
  const runtime = await createH5PRuntime();

  // The installed MultiChoice version decides the ubername we must save with.
  const installed = await runtime.editor.libraryManager.listInstalledLibraries(
    'H5P.MultiChoice'
  );
  const versions = installed['H5P.MultiChoice'] ?? [];
  if (versions.length === 0) {
    console.error(
      'H5P.MultiChoice is not installed. Import a MultiChoice package or run:\n' +
        '  npx tsx scripts/hub-install.ts H5P.MultiChoice'
    );
    process.exit(1);
  }
  const latest = versions[versions.length - 1];
  const ubername = `H5P.MultiChoice ${latest.majorVersion}.${latest.minorVersion}`;

  const draft = loadDraftFromYaml(fs.readFileSync(draftPath, 'utf-8'));
  const activities = transformDraft(
    draft,
    `${latest.majorVersion}.${latest.minorVersion}`
  );

  console.log(`draft: ${draft.title} (${draft.questions.length} questions)`);
  console.log(`target library: ${ubername}\n`);

  for (const activity of activities) {
    const contentId = await runtime.editor.saveOrUpdateContent(
      undefined as unknown as string,
      activity.params,
      activity.metadata as any,
      activity.mainLibraryUbername,
      AUTHOR_USER
    );

    // Register it as a PFY activity, carrying the draft's pedagogical settings
    // rather than re-deriving them from the generated params.
    const registered = registerActivity({
      title: activity.metadata.title,
      mainLibrary: ubername,
      h5pContentId: String(contentId),
      behavior: {
        ...deriveBehavior(activity.params),
        pass_percentage: draft.pass_percentage,
        allow_retry: draft.allow_retry,
        allow_show_solution: draft.allow_show_solution,
        randomize_answers: draft.randomize_answers,
        max_attempts: null
      },
      status: 'draft' // a human reviews before publication
    });

    console.log(`✓ ${activity.metadata.title}`);
    console.log(`    activity ${registered.uuid} (status: ${registered.status})`);
    console.log(`    review   http://localhost:8080/author/${registered.uuid}`);
    console.log(`    preview  http://localhost:8080/play/${registered.uuid}`);
  }
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
