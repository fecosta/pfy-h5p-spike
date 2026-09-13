import yaml from 'js-yaml';

import { parseDraft, type AuthoringDraft } from './schema';

/** Parses and validates a YAML draft. Invalid drafts throw, never half-apply. */
export function loadDraftFromYaml(source: string): AuthoringDraft {
  return parseDraft(yaml.load(source));
}
