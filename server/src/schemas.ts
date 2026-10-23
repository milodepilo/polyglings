// Runtime validation for everything that comes from OUTSIDE the server:
// HTTP request bodies (milestone 2) and exercises written by the LLM (milestone 5).
// types.ts says what data should look like; this file checks that it actually does.
// Lesson: ../lessons/02_http_zod.md

import { z } from "zod";

import { LANGUAGES, DIFFICULTY } from "./types.js";
const nonEmptyString = z.string().min(1);
export const ExerciseSchema = z.object({
  id: nonEmptyString,
  lang: z.enum(LANGUAGES),
  topic: nonEmptyString.max(200),
  difficulty: z.literal(DIFFICULTY),
  description: nonEmptyString,
  starter: nonEmptyString,
  tests: nonEmptyString,
  hint: nonEmptyString,
  solution: nonEmptyString,
  createdAt: z.iso.datetime(),
  prompt: nonEmptyString.exactOptional(),
});

export const CheckResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pass") }),
  z.object({ status: z.literal("timeout") }),
  z.object({ status: z.literal("fail"), output: z.string() }),
  z.object({ status: z.literal("compile_error"), output: z.string() }),
]);

export const GenerateRequestSchema = z.object({
  lang: z.enum(LANGUAGES),
  topic: nonEmptyString.max(200).exactOptional(),
});

export const SubmitRequestSchema = z.object({
  code: nonEmptyString.max(100_000),
});

export const QueryListSchema = z.object({
  lang: z.enum(LANGUAGES).exactOptional(),
});

export const SolvedExerciseSchema = ExerciseSchema.pick({
  lang: true,
  difficulty: true,
}).extend({ solvedAt: z.string() });
