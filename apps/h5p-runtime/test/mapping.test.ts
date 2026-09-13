import { describe, expect, it } from 'vitest';

import { deriveBehavior, parseLegacyWordPressId, slugify } from '../src/adapter/mapping';

describe('parseLegacyWordPressId', () => {
  it('recovers the WordPress content id from an export filename', () => {
    expect(
      parseLegacyWordPressId('1-de-acordo-com-o-texto-e-possivel-afirmar-que-141.h5p')
    ).toBe(141);
    expect(parseLegacyWordPressId('quiz-question-set-7.h5p')).toBe(7);
  });

  it('returns null when the filename carries no id', () => {
    expect(
      parseLegacyWordPressId('conectores_funcoes_discursivas_documentation_tool.h5p')
    ).toBeNull();
    expect(parseLegacyWordPressId('export.h5p')).toBeNull();
  });
});

describe('deriveBehavior', () => {
  it('reads MultiChoice-style behaviour.passPercentage', () => {
    expect(
      deriveBehavior({
        behaviour: { passPercentage: 80, enableRetry: true, enableSolutionsButton: true }
      })
    ).toMatchObject({ pass_percentage: 80, allow_retry: true, allow_show_solution: true });
  });

  it('reads QuestionSet-style top-level passPercentage', () => {
    // QuestionSet has no `behaviour` object at all; its pass criterion sits at
    // the root of the params.
    expect(deriveBehavior({ passPercentage: 50 })).toMatchObject({
      pass_percentage: 50
    });
  });

  it('defaults to requiring every point when no criterion is stated', () => {
    // TrueFalse, Blanks and DragQuestion state none.
    expect(deriveBehavior({ behaviour: {} }).pass_percentage).toBe(100);
    expect(deriveBehavior({}).pass_percentage).toBe(100);
    expect(deriveBehavior(undefined).pass_percentage).toBe(100);
  });

  it('treats retry as enabled unless the activity disables it', () => {
    expect(deriveBehavior({ behaviour: { enableRetry: false } }).allow_retry).toBe(false);
    expect(deriveBehavior({ behaviour: {} }).allow_retry).toBe(true);
  });

  it('clamps out-of-range percentages', () => {
    expect(deriveBehavior({ passPercentage: 140 }).pass_percentage).toBe(100);
    expect(deriveBehavior({ passPercentage: -5 }).pass_percentage).toBe(0);
  });
});

describe('slugify', () => {
  it('strips Portuguese diacritics', () => {
    expect(slugify('De acordo com o texto, é possível afirmar que:')).toBe(
      'de-acordo-com-o-texto-e-possivel-afirmar-que'
    );
    expect(slugify('Que horas são?')).toBe('que-horas-sao');
  });

  it('never returns an empty slug', () => {
    expect(slugify('???')).toBe('activity');
  });
});
