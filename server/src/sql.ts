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
