// Core domain types for polyglings. Everything else (db, runner, generator,
// http) imports from here, so this file is the "contract" of the server.
// Lesson: ../lessons/01_ts_basics.md

export const LANGUAGES = ["cpp", "ts", "js"] as const;
export const DIFFICULTY = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export type Language = (typeof LANGUAGES)[number];
export function isLanguage(s: string): s is Language {
  return (LANGUAGES as readonly string[]).includes(s);
}
export type Difficulty = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export interface Exercise {
  id: string;
  lang: Language;
  topic: string;
  difficulty: Difficulty;
  description: string;
  starter: string;
  tests: string;
  hint: string;
  solution: string;
  createdAt: string;
  prompt?: string;
}
export type CheckResult =
  | { status: "pass" }
  | { status: "fail"; output: string }
  | { status: "timeout"; output: string }
  | { status: "compile_error"; output: string };
