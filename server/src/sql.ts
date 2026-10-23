export const CREATE_EXERCISE_TABLE = /* sql */ ` 
  CREATE TABLE IF NOT EXISTS exercises (
    id          TEXT PRIMARY KEY,
    lang        TEXT NOT NULL CHECK (lang IN ('cpp', 'ts', 'js')),
    topic       TEXT NOT NULL,
    difficulty  INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 10),
    description TEXT NOT NULL,
    starter     TEXT NOT NULL,
    tests       TEXT NOT NULL,
    hint        TEXT NOT NULL,
    solution    TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    prompt      TEXT
  )`;
export const UPSERT_EXERCISE = /* sql */ `
  INSERT INTO exercises
    (id, lang, topic, difficulty, description, starter, tests, hint, solution, created_at, prompt)
  VALUES
    (:id, :lang, :topic, :difficulty, :description, :starter, :tests, :hint, :solution, :createdAt, :prompt)
  ON CONFLICT(id) DO UPDATE SET
    lang        = excluded.lang,
    topic       = excluded.topic,
    difficulty  = excluded.difficulty,
    description = excluded.description,
    starter     = excluded.starter,
    tests       = excluded.tests,
    hint        = excluded.hint,
    solution    = excluded.solution,
    created_at  = excluded.created_at,
    prompt      = excluded.prompt
`;
export const GET_EXERCISE = /* sql */ `SELECT * FROM exercises`;
export const GET_EXERCISE_BY_ID = GET_EXERCISE + /* sql */ ` WHERE id = ?`;
export const GET_EXERCISE_BY_LANG = GET_EXERCISE + /* sql */ ` WHERE lang = ?`;

// Milestone 6b (given). One row per run of your code; exercise_id must exist in exercises.
export const CREATE_SUBMISSION_TABLE = /* sql */ `
  CREATE TABLE IF NOT EXISTS submissions (
    id           INTEGER PRIMARY KEY,
    exercise_id  TEXT NOT NULL REFERENCES exercises(id),
    status       TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'timeout', 'compile_error')),
    submitted_at TEXT NOT NULL
  )`;
export const INSERT_SUBMISSION = /* sql */ `
  INSERT INTO submissions (exercise_id, status, submitted_at)
  VALUES (:exerciseId, :status, :submittedAt)`;
// One row per exercise with at least one pass: its lang, difficulty and FIRST pass.
// Rows look like { lang: "ts", difficulty: 2, solved_at: "2026-10-21T09:00:00.000Z" }
export const LIST_SOLVED = /* sql */ `
  SELECT e.lang, e.difficulty, MIN(s.submitted_at) AS solved_at
  FROM submissions s
  JOIN exercises e ON e.id = s.exercise_id
  WHERE s.status = 'pass'
  GROUP BY s.exercise_id`;
