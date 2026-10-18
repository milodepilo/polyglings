// ExerciseStore backed by SQLite, so exercises survive a restart.
// Same interface as MemoryStore: app.ts doesn't know or care which one it gets.
// Lesson: ../lessons/03_sqlite.md
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { ExerciseStore, ListFilter } from "./store.js";
import type { Exercise } from "./types.js";
import * as sql from "./sql.js";
import { ExerciseSchema } from "./schemas.js";

export class SqliteStore implements ExerciseStore {
  private readonly db: DatabaseSync;

  // path: a file like "polyglings.db", or ":memory:" for a throwaway database
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(sql.CREATE_EXERCISE_TABLE);
  }
  private rowToExercise(row: Record<string, SQLOutputValue>): Exercise {
    const { created_at, prompt, ...rest } = row;
    const exercise = ExerciseSchema.parse({
      ...rest,
      createdAt: created_at,
      ...(prompt === null ? {} : { prompt: prompt }),
    });
    return exercise;
  }

  get(id: string): Exercise | undefined {
    const stmt = this.db.prepare(sql.GET_EXERCISE_BY_ID);
    const row = stmt.get(id);
    return row === undefined ? undefined : this.rowToExercise(row);
  }

  list(filter: ListFilter = {}): Exercise[] {
    const rows =
      filter.lang === undefined
        ? this.db.prepare(sql.GET_EXERCISE).all()
        : this.db.prepare(sql.GET_EXERCISE_BY_LANG).all(filter.lang);
    return rows.map((row) => this.rowToExercise(row));
  }
  add(exercise: Exercise): void {
    const stmt = this.db.prepare(sql.UPSERT_EXERCISE);
    stmt.run({ ...exercise, prompt: exercise.prompt ?? null });
  }

  close(): void {
    this.db.close();
  }
}
