import { z } from 'zod';

/**
 * The PFY authoring draft: a small, human-readable intermediate representation
 * that sits between an LLM and H5P.
 *
 * The point of the indirection is that an LLM is never asked to emit an H5P
 * package, or even H5P params. It emits this, which is small enough to validate
 * strictly and to review in a diff; the deterministic transformer turns it into
 * valid H5P content. A malformed draft fails validation instead of producing a
 * subtly broken activity.
 */
export const answerSchema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
  /** Shown when the learner picks this answer. */
  feedback_when_chosen: z.string().optional(),
  /** Shown when the learner does not pick this answer. */
  feedback_when_not_chosen: z.string().optional(),
  tip: z.string().optional()
});

export const questionSchema = z.object({
  prompt: z.string().min(1),
  answers: z.array(answerSchema).min(2),
  feedback: z
    .object({
      correct: z.string().optional(),
      incorrect: z.string().optional()
    })
    .optional()
});

export const draftSchema = z.object({
  type: z.literal('multiple-choice'),
  title: z.string().min(1).max(255),
  language: z.string().default('pt-BR'),
  level: z.string().optional(),
  /** 0-100; becomes both H5P behaviour.passPercentage and PFY pass_percentage. */
  pass_percentage: z.number().min(0).max(100).default(100),
  allow_retry: z.boolean().default(true),
  allow_show_solution: z.boolean().default(true),
  randomize_answers: z.boolean().default(false),
  questions: z.array(questionSchema).min(1)
});

export type AuthoringDraft = z.infer<typeof draftSchema>;
export type DraftQuestion = z.infer<typeof questionSchema>;
export type DraftAnswer = z.infer<typeof answerSchema>;

export class DraftValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[]
  ) {
    super(message);
    this.name = 'DraftValidationError';
  }
}

export function parseDraft(input: unknown): AuthoringDraft {
  const result = draftSchema.safeParse(input);
  if (!result.success) {
    throw new DraftValidationError(
      `invalid authoring draft: ${result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
      result.error.issues
    );
  }

  // Semantic checks the schema cannot express.
  result.data.questions.forEach((question, index) => {
    if (!question.answers.some((a) => a.correct)) {
      throw new DraftValidationError(
        `question ${index + 1} ("${question.prompt.slice(0, 40)}") has no correct answer`,
        []
      );
    }
  });

  return result.data;
}
