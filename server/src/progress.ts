// Your level per language, computed from what you've solved: never stored, always derived.
// Change a rule here and every level is recomputed from the same history.
// Lesson: ../lessons/06_progress.md
import { LANGUAGES, type Difficulty, type Language } from "./types.js";

// One exercise you solved: its first passing submission. (6b gets these from SQLite.)
export interface SolvedExercise {
  lang: Language;
  difficulty: Difficulty;
  solvedAt: string; // ISO timestamp of the first "pass"
}

export interface LangProgress {
  level: Difficulty; // the difficulty of your next exercise
  towardNext: number; // solved at this level since the last level-up (0..SOLVES_TO_LEVEL_UP-1)
  solved: number; // total solved in this language, any difficulty
}

export type Progress = Record<Language, LangProgress>;

export const SOLVES_TO_LEVEL_UP = 3;
export const MAX_LEVEL: Difficulty = 10;

export function computeProgress(solved: SolvedExercise[]): Progress {
  const progress = {} as Progress;
  for (const lang of LANGUAGES)
    progress[lang] = { level: 1, towardNext: 0, solved: 0 };
  const sortedSolved = solved.toSorted((a, b) =>
    a.solvedAt.localeCompare(b.solvedAt),
  );
  for (const solve of sortedSolved) {
    const languageProgress = progress[solve.lang];
    languageProgress.solved++;
    if (solve.difficulty >= languageProgress.level) {
      if (languageProgress.level === MAX_LEVEL) {
        continue;
      }
      languageProgress.towardNext++;
      if (languageProgress.towardNext === SOLVES_TO_LEVEL_UP) {
        languageProgress.level++ as Difficulty;
        languageProgress.towardNext = 0;
      }
    }
    if (solve.difficulty < languageProgress.level) {
      continue;
    }
  }
  return progress;
}
