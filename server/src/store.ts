// Where exercises live. The HTTP layer only talks to this interface, so the
// storage can change (in-memory now, SQLite in milestone 3) without touching app.ts.
import type { SolvedExercise } from "./progress.js";
import type { CheckResult, Exercise, Language } from "./types.js";

export interface ListFilter {
  lang?: Language;
}

// One run of your code against an exercise's tests (milestone 6b)
export interface Submission {
  exerciseId: string;
  status: CheckResult["status"];
  submittedAt: string; // ISO timestamp
}

export interface ExerciseStore {
  get(id: string): Exercise | undefined;
  list(filter?: ListFilter): Exercise[];
  add(exercise: Exercise): void;
  // throws if the exercise doesn't exist
  addSubmission(submission: Submission): void;
  // one entry per exercise with at least one "pass", dated by its FIRST pass; any order
  listSolved(): SolvedExercise[];
}

// Simple Map-backed store for development and tests. Lost on restart.
export class MemoryStore implements ExerciseStore {
  private readonly exercises = new Map<string, Exercise>();

  constructor(initial: Exercise[] = []) {
    for (const exercise of initial) this.add(exercise);
  }

  get(id: string): Exercise | undefined {
    return this.exercises.get(id);
  }

  list(filter: ListFilter = {}): Exercise[] {
    const all = [...this.exercises.values()];
    return filter.lang ? all.filter((e) => e.lang === filter.lang) : all;
  }

  add(exercise: Exercise): void {
    this.exercises.set(exercise.id, exercise);
  }

  private readonly submissions: Submission[] = [];

  addSubmission(submission: Submission): void {
    if (!this.exercises.has(submission.exerciseId)) {
      throw new Error(`no exercise ${submission.exerciseId}`);
    }
    this.submissions.push(submission);
  }

  listSolved(): SolvedExercise[] {
    const firstPass = new Map<string, string>(); // exerciseId → earliest pass
    for (const { exerciseId, status, submittedAt } of this.submissions) {
      if (status !== "pass") continue;
      const earlier = firstPass.get(exerciseId);
      if (earlier === undefined || submittedAt < earlier) firstPass.set(exerciseId, submittedAt);
    }
    return [...firstPass].map(([id, solvedAt]) => {
      const { lang, difficulty } = this.exercises.get(id)!; // addSubmission checked it exists
      return { lang, difficulty, solvedAt };
    });
  }
}
