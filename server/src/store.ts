// Where exercises live. The HTTP layer only talks to this interface, so the
// storage can change (in-memory now, SQLite in milestone 3) without touching app.ts.
import type { Exercise, Language } from "./types.js";

export interface ListFilter {
  lang?: Language;
}

export interface ExerciseStore {
  get(id: string): Exercise | undefined;
  list(filter?: ListFilter): Exercise[];
  add(exercise: Exercise): void;
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
}
