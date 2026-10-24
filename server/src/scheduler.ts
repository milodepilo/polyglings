// The daily job: for every language with nothing open, generate one new exercise
// at your current level for that language. Part A is the job itself; part B runs it every morning.
// Lesson: ../lessons/07_scheduler.md
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

// ---------------------------------------------------------------------------
// Part B: run it every day at a fixed hour (lesson 07 part B)
// ---------------------------------------------------------------------------

// Milliseconds from `now` until the next time the local clock shows `hour`:00:00.000.
// Always > 0: at exactly 07:00:00.000, the next 07:00 is tomorrow.
export function msUntilNext(hour: number, now: Date): number {
  const due = new Date(now);
  due.setHours(hour, 0, 0, 0);
  if (now.getTime() >= due.getTime()) {
    due.setDate(due.getDate() + 1);
  }
  return due.getTime() - now.getTime();
}

export interface SchedulerOptions {
  hour: number; // local time, 0-23
  run: () => Promise<void>;
  onError?: (err: unknown) => void; // run() threw: report it, the schedule keeps going
}

// Given. A fresh setTimeout for every run (not setInterval): each delay is measured
// against the real clock again, so drift and daylight saving time can't pile up.
export function startScheduler(opts: SchedulerOptions): { stop: () => void } {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    timer = setTimeout(
      async () => {
        try {
          await opts.run();
        } catch (err) {
          opts.onError?.(err);
        }
        scheduleNext(); // only after run() is done: two runs never overlap
      },
      msUntilNext(opts.hour, new Date()),
    );
  };

  scheduleNext();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
