import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  DraftValidationError,
  loadDraftFromYaml,
  parseDraft,
  transformDraft
} from '../src';

const draftYaml = fs.readFileSync(
  path.join(__dirname, '../fixtures/por-ou-para.draft.yaml'),
  'utf-8'
);

describe('authoring draft validation', () => {
  it('accepts the reference draft', () => {
    const draft = loadDraftFromYaml(draftYaml);
    expect(draft.title).toBe('Por ou para?');
    expect(draft.language).toBe('pt-BR');
    expect(draft.questions).toHaveLength(2);
  });

  it('rejects a question with no correct answer', () => {
    expect(() =>
      parseDraft({
        type: 'multiple-choice',
        title: 'Broken',
        questions: [
          {
            prompt: 'x',
            answers: [
              { text: 'a', correct: false },
              { text: 'b', correct: false }
            ]
          }
        ]
      })
    ).toThrow(DraftValidationError);
  });

  it('rejects a question with a single answer', () => {
    expect(() =>
      parseDraft({
        type: 'multiple-choice',
        title: 'Broken',
        questions: [{ prompt: 'x', answers: [{ text: 'a', correct: true }] }]
      })
    ).toThrow(DraftValidationError);
  });

  it('applies defaults rather than producing undefined behaviour', () => {
    const draft = parseDraft({
      type: 'multiple-choice',
      title: 'Defaults',
      questions: [
        {
          prompt: 'x',
          answers: [
            { text: 'a', correct: true },
            { text: 'b', correct: false }
          ]
        }
      ]
    });
    expect(draft.pass_percentage).toBe(100);
    expect(draft.allow_retry).toBe(true);
    expect(draft.language).toBe('pt-BR');
  });
});

describe('draft -> H5P.MultiChoice params', () => {
  const draft = loadDraftFromYaml(draftYaml);
  const activities = transformDraft(draft);

  it('produces one activity per question', () => {
    expect(activities).toHaveLength(2);
    expect(activities[0].metadata.title).toBe('Por ou para? (1/2)');
    expect(activities[0].mainLibraryUbername).toBe('H5P.MultiChoice 1.16');
  });

  it('emits the markup the H5P editor itself produces', () => {
    const { params } = activities[0];
    expect(params.question).toBe('<p>Eu vou ___ São Paulo amanhã.</p>');
    expect(params.answers[0].text).toBe('<div>para</div>');
  });

  it('marks exactly the drafted answers correct', () => {
    const { params } = activities[0];
    expect(params.answers.map((a) => a.correct)).toEqual([true, false]);
  });

  it('flattens overallFeedback to an array, as H5P semantics require', () => {
    const { params } = activities[0];
    expect(Array.isArray(params.overallFeedback)).toBe(true);
    // Ranges tile 0-100 with no gap and no overlap.
    expect(params.overallFeedback).toEqual([
      { from: 0, to: 99, feedback: 'Reveja o uso de "por" e "para".' },
      { from: 100, to: 100, feedback: 'Muito bem! Você acertou @score de @total.' }
    ]);
  });

  it('carries the pass criterion into H5P behaviour', () => {
    expect(activities[0].params.behaviour.passPercentage).toBe(100);
    expect(activities[0].params.behaviour.enableRetry).toBe(true);
    expect(activities[0].params.behaviour.singlePoint).toBe(false);
  });

  it('ships Portuguese UI strings inside the content', () => {
    expect(activities[0].params.UI.checkAnswerButton).toBe('Verificar');
    expect(activities[0].params.confirmRetry.confirmLabel).toBe('Confirmar');
  });

  it('escapes draft prose rather than trusting it as markup', () => {
    const [activity] = transformDraft(
      parseDraft({
        type: 'multiple-choice',
        title: 'XSS',
        questions: [
          {
            prompt: '<script>alert(1)</script>',
            answers: [
              { text: 'a & b', correct: true },
              { text: 'c', correct: false }
            ]
          }
        ]
      })
    );
    expect(activity.params.question).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
    );
    expect(activity.params.answers[0].text).toBe('<div>a &amp; b</div>');
  });

  it('renders inline (div), matching every imported PFY activity', () => {
    expect(activities[0].metadata.embedTypes).toEqual(['div']);
  });

  it('omits mainLibrary/preloadedDependencies, which the server recomputes', () => {
    const metadata = activities[0].metadata as Record<string, unknown>;
    expect(metadata.mainLibrary).toBeUndefined();
    expect(metadata.preloadedDependencies).toBeUndefined();
    expect(metadata.title).toBeTruthy();
  });
});
