/** Strict zod shape every grader's JSON verdict must satisfy (run.ts and score.ts share it). */
import { z } from 'zod';

import { EVAL_CATEGORIES } from '../types';

export const graderVerdictSchema = z.object({
  categoryScores: z.array(
    z.object({
      category: z.enum(EVAL_CATEGORIES),
      score: z.number().min(0).max(10),
      rationale: z.string(),
      examples: z.array(z.string()).optional()
    })
  ),
  lineNotes: z.array(z.string()).optional()
});
