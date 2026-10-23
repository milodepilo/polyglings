// ExerciseStore backed by SQLite, so exercises survive a restart.
// Same interface as MemoryStore: app.ts doesn't know or care which one it gets.
// Lesson: ../lessons/03_sqlite.md
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { SolvedExercise } from "./progress.js";
import type { ExerciseStore, ListFilter, Submission } from "./store.js";
import type { Exercise } from "./types.js";
import * as sql from "./sql.js";
import { ExerciseSchema, SolvedExerciseSchema } from "./schemas.js";

export class SqliteStore implements ExerciseStore {
  private readonly db: DatabaseSync;

  // path: a file like "polyglings.db", or ":memory:" for a throwaway database
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(sql.CREATE_EXERCISE_TABLE);
    this.db.exec(sql.CREATE_SUBMISSION_TABLE); // after exercises: it refers to that table
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

  private rowToSolvedExercise(
    row: Record<string, SQLOutputValue>,
  ): SolvedExercise {
    const { solved_at, lang, difficulty } = row;
    const exercise = SolvedExerciseSchema.parse({
      difficulty,
      solvedAt: solved_at,
      lang,
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

  // milestone 6b (yours, see the TODO in app.ts): the SQL is in sql.ts
  addSubmission(submission: Submission): void {
    const stmt = this.db.prepare(sql.INSERT_SUBMISSION);
    stmt.run({
      ...submission,
    });
  }

  listSolved(): SolvedExercise[] {
    const rows = this.db.prepare(sql.LIST_SOLVED).all();
    return rows.map((row) => this.rowToSolvedExercise(row));
  }

  close(): void {
    this.db.close();
  }
}
