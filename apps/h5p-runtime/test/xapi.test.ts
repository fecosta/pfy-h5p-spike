import { describe, expect, it } from 'vitest';

import {
  isTopLevel,
  localContentId,
  normalizeStatement,
  parseIso8601Duration
} from '../src/adapter/xapi';

const completed = (result: Record<string, unknown>) => ({
  verb: { id: 'http://adlnet.gov/expapi/verbs/completed' },
  object: {
    definition: {
      extensions: { 'http://h5p.org/x-api/h5p-local-content-id': '42' }
    }
  },
  result
});

describe('parseIso8601Duration', () => {
  it('parses the shapes H5P emits', () => {
    expect(parseIso8601Duration('PT12.5S')).toBe(13);
    expect(parseIso8601Duration('PT1M13.24S')).toBe(73);
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
  });

  it('returns null for missing or unparseable values', () => {
    expect(parseIso8601Duration(undefined)).toBeNull();
    expect(parseIso8601Duration('')).toBeNull();
    expect(parseIso8601Duration('12s')).toBeNull();
    expect(parseIso8601Duration('PT')).toBeNull();
  });
});

describe('statement filtering', () => {
  it('treats a statement with no parent activity as top level', () => {
    expect(isTopLevel(completed({}))).toBe(true);
  });

  it('rejects sub-content statements', () => {
    // A question inside a QuestionSet or Column reports its own completion;
    // counting those would complete the attempt on the first sub-question.
    const sub = {
      ...completed({}),
      context: { contextActivities: { parent: [{ id: 'x' }] } }
    };
    expect(isTopLevel(sub)).toBe(false);
    expect(normalizeStatement(sub, 1).kind).toBe('ignored');
  });

  it('extracts the H5P local content id', () => {
    expect(localContentId(completed({}))).toBe('42');
    expect(localContentId({} as any)).toBeNull();
  });

  it('ignores verbs that are not completed/answered', () => {
    const interacted = {
      ...completed({}),
      verb: { id: 'http://adlnet.gov/expapi/verbs/interacted' }
    };
    const result = normalizeStatement(interacted, 1);
    expect(result.kind).toBe('ignored');
  });
});

describe('normalizeStatement', () => {
  it('maps a fully correct result onto the PFY contract', () => {
    const result = normalizeStatement(
      completed({
        score: { raw: 2, max: 2, min: 0, scaled: 1 },
        success: true,
        completion: true,
        duration: 'PT30S'
      }),
      1
    );

    expect(result.kind).toBe('outcome');
    if (result.kind !== 'outcome') return;
    expect(result.outcome).toMatchObject({
      score_raw: 2,
      score_max: 2,
      score_min: 0,
      score_scaled: 1,
      pass_threshold: 1,
      is_passed: true,
      is_completed: true,
      duration_seconds: 30,
      verb: 'passed',
      score_provenance: 'client_reported'
    });
  });

  it('prefers the activity-reported success over the threshold comparison', () => {
    // H5P.QuestionSet applies its own passPercentage; when the activity says
    // it passed, that wins over our recomputation.
    const result = normalizeStatement(
      completed({
        score: { raw: 1, max: 2, min: 0 },
        success: true,
        completion: true
      }),
      1
    );
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.score_scaled).toBe(0.5);
    expect(result.outcome.is_passed).toBe(true);
    expect(result.outcome.verb).toBe('passed');
  });

  it('falls back to the threshold when success is absent', () => {
    const result = normalizeStatement(
      completed({ score: { raw: 1, max: 2, min: 0 }, completion: true }),
      1
    );
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.is_passed).toBe(false);
    expect(result.outcome.verb).toBe('failed');
  });

  it('records an unscored completion without inventing a zero', () => {
    // Accordion and friends complete but never report a score.
    const result = normalizeStatement(completed({ completion: true }), 1);
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.score_raw).toBeNull();
    expect(result.outcome.score_max).toBeNull();
    expect(result.outcome.score_scaled).toBeNull();
    expect(result.outcome.is_passed).toBeNull();
    expect(result.outcome.is_completed).toBe(true);
    expect(result.outcome.verb).toBe('completed');
  });

  it('leaves duration null when the activity does not report one', () => {
    const result = normalizeStatement(
      completed({ score: { raw: 1, max: 1 }, completion: true }),
      1
    );
    if (result.kind !== 'outcome') throw new Error('expected outcome');
    expect(result.outcome.duration_seconds).toBeNull();
  });
});
