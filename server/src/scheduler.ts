// The daily job: for every language with nothing open, generate one new exercise
// at your current level for that language. Part A is the job itself; part B runs it every morning.
// Lesson: ../lessons/07_scheduler.md
import { diff } from "node:util";
import type { GenerationRequest } from "./generator.js";
import { computeProgress } from "./progress.js";
import type { ExerciseStore } from "./store.js";
import { LANGUAGES, type Exercise, type Language } from "./types.js";

export interface DailyDeps {
  store: ExerciseStore;
  generate: (req: GenerationRequest) => Promise<Exercise>;
}

export interface GenerationFailure {
  lang: Language;
  reason: string; // the error's message, or the thrown value as text
}

export interface SkippedLanguage {
  lang: Language;
  open: number; // how many exercises in this language are still open
}

// every language ends up in exactly one of the three lists
export interface DailyResult {
  added: Exercise[];
  failed: GenerationFailure[];
  skipped: SkippedLanguage[];
}

export async function runDaily(deps: DailyDeps): Promise<DailyResult> {
  const progress = computeProgress(deps.store.listSolved());
  const result: DailyResult = { added: [], failed: [], skipped: [] };
  const openExercises = deps.store.listOpen();
  for (const lang of LANGUAGES) {
    const filteredExercises = openExercises.filter((e) => e.lang === lang);
    if (filteredExercises.length > 0) {
      result.skipped.push({ lang, open: filteredExercises.length });
      continue;
    }
    try {
      const generated = await deps.generate({
        lang,
        difficulty: progress[lang].level,
      });
      deps.store.add(generated);
      result.added.push(generated);
    } catch (err) {
      result.failed.push({
        lang,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
