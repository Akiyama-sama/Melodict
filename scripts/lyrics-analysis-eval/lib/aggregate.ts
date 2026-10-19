/**
 * Verdict aggregation math shared by run.ts and score.ts. Category labels are display copy and
 * stay in each script on purpose (run.ts uses a terse grader-facing variant, score.ts a detailed
 * rubric variant) — only the arithmetic lives here.
 */
import { EVAL_CATEGORIES, type EvalCategory, type GraderVerdict } from '../types';

/** Buckets each category score by category and returns the mean per category (0 when empty). */
export const aggregatePerCategory = (categoryScores: Array<{ category: EvalCategory; score: number }>) => {
  const perCategory = new Map<EvalCategory, number[]>();
  for (const score of categoryScores) {
    const bucket = perCategory.get(score.category) ?? [];
    bucket.push(score.score);
    perCategory.set(score.category, bucket);
  }
  const categoryMean = (category: EvalCategory) => {
    const bucket = perCategory.get(category);
    return bucket && bucket.length > 0 ? bucket.reduce((a, b) => a + b, 0) / bucket.length : 0;
  };
  const overall =
    (EVAL_CATEGORIES.reduce((sum, category) => sum + categoryMean(category), 0) / EVAL_CATEGORIES.length) * 10;
  return { categoryMean, overall };
};

/** Per-category mean across all graders, rounded to 1 decimal (0-10 scale). */
export const aggregateCategoryMeans = (verdicts: GraderVerdict[]): Record<EvalCategory, number> =>
  Object.fromEntries(
    EVAL_CATEGORIES.map((category) => {
      const values = verdicts.flatMap((verdict) =>
        verdict.categoryScores.filter((score) => score.category === category).map((score) => score.score)
      );
      return [category, values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0];
    })
  ) as Record<EvalCategory, number>;

/** Mean of the graders' overall scores, rounded to 1 decimal (0-100 scale). */
export const aggregateOverallMean = (verdicts: GraderVerdict[]): number =>
  Math.round((verdicts.reduce((sum, verdict) => sum + verdict.overall, 0) / verdicts.length) * 10) / 10;
