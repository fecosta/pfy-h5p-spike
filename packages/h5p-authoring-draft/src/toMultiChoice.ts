import type { AuthoringDraft, DraftQuestion } from './schema';

/**
 * PFY draft -> H5P.MultiChoice content params.
 *
 * Shape notes that are easy to get wrong and that the spike verified against
 * h5p-multi-choice's semantics.json:
 *  - `overallFeedback` is declared in semantics as a group containing a single
 *    field of the same name, and H5P flattens single-child groups. The value in
 *    content.json is therefore the ARRAY itself, not `{ overallFeedback: [...] }`.
 *  - feedback ranges are percentages, inclusive at both ends, first match wins,
 *    and an entry with empty `feedback` is skipped by H5P.Question.
 *  - rich-text fields carry the markup the H5P editor itself produces
 *    (`<p>` for the question, `<div>` for answers), so a round-trip through the
 *    editor does not rewrite them.
 *  - `UI` strings are part of the content, not the platform: they are why an
 *    imported activity shows "Verificar" rather than "Check".
 */

const PT_BR_UI = {
  checkAnswerButton: 'Verificar',
  submitAnswerButton: 'Enviar',
  showSolutionButton: 'Mostrar solução',
  tryAgainButton: 'Tentar novamente',
  tipsLabel: 'Mostrar dica',
  scoreBarLabel: 'Você acertou :num de :total pontos',
  tipAvailable: 'Dica disponível',
  feedbackAvailable: 'Feedback disponível',
  readFeedback: 'Ler feedback',
  wrongAnswer: 'Resposta incorreta',
  correctAnswer: 'Resposta correta',
  shouldCheck: 'Deveria ter sido marcada',
  shouldNotCheck: 'Não deveria ter sido marcada',
  noInput: 'Responda antes de ver a solução',
  a11yCheck:
    'Verificar as respostas. As respostas serão marcadas como corretas, incorretas ou não respondidas.',
  a11yShowSolution:
    'Mostrar a solução. A tarefa será marcada com sua solução correta.',
  a11yRetry:
    'Refazer a tarefa. Redefinir todas as respostas e começar a tarefa novamente.'
} as const;

const PT_BR_CONFIRM_CHECK = {
  header: 'Finalizar?',
  body: 'Tem certeza de que deseja finalizar?',
  cancelLabel: 'Cancelar',
  confirmLabel: 'Finalizar'
} as const;

const PT_BR_CONFIRM_RETRY = {
  header: 'Tentar novamente?',
  body: 'Tem certeza de que deseja tentar novamente?',
  cancelLabel: 'Cancelar',
  confirmLabel: 'Confirmar'
} as const;

/** Minimal, deliberate escaping: drafts are prose, not markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface MultiChoiceParams {
  media: { disableImageZooming: boolean };
  question: string;
  answers: Array<{
    text: string;
    correct: boolean;
    tipsAndFeedback: {
      tip: string;
      chosenFeedback: string;
      notChosenFeedback: string;
    };
  }>;
  overallFeedback: Array<{ from: number; to: number; feedback?: string }>;
  UI: typeof PT_BR_UI;
  behaviour: Record<string, unknown>;
  confirmCheck: typeof PT_BR_CONFIRM_CHECK;
  confirmRetry: typeof PT_BR_CONFIRM_RETRY;
}

export function questionToMultiChoiceParams(
  question: DraftQuestion,
  draft: AuthoringDraft
): MultiChoiceParams {
  const pass = Math.round(draft.pass_percentage);

  // Ranges must tile 0-100 without gaps or overlaps: H5P floors the score ratio
  // to an integer percentage and takes the first matching range.
  const overallFeedback: MultiChoiceParams['overallFeedback'] =
    pass <= 0
      ? [{ from: 0, to: 100, feedback: question.feedback?.correct ?? '' }]
      : [
          {
            from: 0,
            to: Math.max(0, pass - 1),
            feedback: question.feedback?.incorrect ?? ''
          },
          { from: pass, to: 100, feedback: question.feedback?.correct ?? '' }
        ];

  return {
    media: { disableImageZooming: false },
    question: `<p>${escapeHtml(question.prompt)}</p>`,
    answers: question.answers.map((answer) => ({
      text: `<div>${escapeHtml(answer.text)}</div>`,
      correct: answer.correct,
      tipsAndFeedback: {
        tip: answer.tip ?? '',
        chosenFeedback: answer.feedback_when_chosen
          ? `<div>${escapeHtml(answer.feedback_when_chosen)}</div>`
          : '',
        notChosenFeedback: answer.feedback_when_not_chosen
          ? `<div>${escapeHtml(answer.feedback_when_not_chosen)}</div>`
          : ''
      }
    })),
    overallFeedback,
    UI: PT_BR_UI,
    behaviour: {
      enableRetry: draft.allow_retry,
      enableSolutionsButton: draft.allow_show_solution,
      enableCheckButton: true,
      // 'auto' => radio buttons when exactly one answer is correct,
      // checkboxes otherwise.
      type: 'auto',
      singlePoint: false,
      randomAnswers: draft.randomize_answers,
      showSolutionsRequiresInput: true,
      confirmCheckDialog: false,
      confirmRetryDialog: false,
      autoCheck: false,
      passPercentage: pass,
      showScorePoints: true
    },
    confirmCheck: PT_BR_CONFIRM_CHECK,
    confirmRetry: PT_BR_CONFIRM_RETRY
  };
}

export interface H5PContentMetadataInput {
  title: string;
  language: string;
  defaultLanguage: string;
  license: string;
  /**
   * PFY's entire legacy corpus is exported with embedTypes ["div"], which makes
   * H5P render inline instead of inside an iframe. Leaving this unset means
   * ContentMetadata defaults to ["iframe"], so generated content would render
   * differently from every imported activity — different CSS inheritance,
   * different height behaviour. Matching the corpus keeps them consistent.
   */
  embedTypes: ['div'];
  /**
   * `mainLibrary` and `preloadedDependencies` are intentionally absent: the
   * server recomputes both from the library it is told to use and from the
   * params, overwriting anything supplied here. Only `title` is actually
   * required by the save-metadata schema.
   */
}

export function draftToMetadata(
  draft: AuthoringDraft,
  question: DraftQuestion,
  index: number,
  total: number
): H5PContentMetadataInput {
  const suffix = total > 1 ? ` (${index + 1}/${total})` : '';
  return {
    title: `${draft.title}${suffix}`.slice(0, 255),
    language: draft.language.toLowerCase(),
    defaultLanguage: draft.language.toLowerCase(),
    license: 'U',
    embedTypes: ['div']
  };
}

export interface TransformedActivity {
  metadata: H5PContentMetadataInput;
  params: MultiChoiceParams;
  /** Whitespace-separated ubername, which is what saveOrUpdateContent expects. */
  mainLibraryUbername: string;
}

/**
 * A draft produces one H5P activity per question: PFY's Activity is the unit a
 * learner attempts, and one MultiChoice question is one attemptable thing.
 */
export function transformDraft(
  draft: AuthoringDraft,
  multiChoiceVersion = '1.16'
): TransformedActivity[] {
  return draft.questions.map((question, index) => ({
    metadata: draftToMetadata(draft, question, index, draft.questions.length),
    params: questionToMultiChoiceParams(question, draft),
    mainLibraryUbername: `H5P.MultiChoice ${multiChoiceVersion}`
  }));
}
