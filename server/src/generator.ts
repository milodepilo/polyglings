// Generates new exercises with an LLM and only accepts the ones that actually work:
// the solution must pass its own tests, and the starter must not.
// Lesson: ../lessons/05_generator.md
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { z } from "zod";
import type { Checker } from "./runner.js";
import { ExerciseSchema } from "./schemas.js";
import type { Difficulty, Exercise, Language } from "./types.js";

// ---------------------------------------------------------------------------
// Part 1: what we ask the LLM for (given)
// ---------------------------------------------------------------------------

// The fields the LLM writes. id, lang, difficulty, createdAt and prompt come from us.
export const ExerciseDraftSchema = ExerciseSchema.pick({
  topic: true,
  description: true,
  starter: true,
  tests: true,
  hint: true,
  solution: true,
});
export type ExerciseDraft = z.infer<typeof ExerciseDraftSchema>;

// The same schema as JSON Schema, for claude's --json-schema flag: one source of truth.
// draft-7: claude's validator rejects zod's default ($schema draft 2020-12)
export const DRAFT_JSON_SCHEMA = z.toJSONSchema(ExerciseDraftSchema, {
  target: "draft-7",
});

export interface GenerationRequest {
  lang: Language;
  difficulty: Difficulty;
  topic?: string; // missing → the LLM picks one that fits the difficulty
}

// How each language's files are run. MUST match TOOLCHAINS in runner.ts.
const CONTRACTS: Record<Language, string> = {
  js: `- "starter" and "solution" are the contents of main.js (an ES module; export what the tests need).
- "tests" is main.test.js, run with \`node main.test.js\`. It imports from "./main.js" and uses
  \`import assert from "node:assert/strict"\`. No test framework: a failing assert exits non-zero.`,
  ts: `- "starter" and "solution" are the contents of main.ts (an ES module; export what the tests need).
- "tests" is main.test.ts, run with \`tsx main.test.ts\`. It imports from "./main.js" (sic, tsx maps
  it to main.ts) and uses \`import assert from "node:assert/strict"\`. No test framework.
- tsx does NOT type-check, so the tests must check behaviour at runtime.`,
  cpp: `- "starter" and "solution" are the contents of main.cpp. They must NOT define main().
- "tests" is test.cpp: it starts with \`#include "main.cpp"\`, then \`#include <cassert>\`, and
  defines int main() with assert() calls. Built with \`g++ -std=c++20 -Wall -o test test.cpp\`.
- Prefer a starter that compiles (stub bodies returning a wrong value) over one that doesn't.`,
};

export function buildPrompt(req: GenerationRequest, feedback?: string): string {
  const topic = req.topic ?? "pick a topic yourself that fits the difficulty";
  return `You write small programming exercises for one learner, like rustlings.

Language: ${req.lang}
Topic: ${topic}
Difficulty: ${req.difficulty} on a scale of 1 (first week of programming) to 10 (expert, tricky edge cases)

Rules:
${CONTRACTS[req.lang]}
- The tests must exit 0 for the solution and fail for the starter.
- The starter has the same names and signatures as the solution, with TODO comments where work is needed.
- "description" is markdown: what to build, with one example. "hint" nudges without giving the answer.
- Standard library only. No input from stdin, no network, no files. Tests run in under a second.
${feedback ? `\nYour previous attempt was rejected:\n${feedback}\nFix that in this attempt.\n` : ""}`;
}

// ---------------------------------------------------------------------------
// Part 2: talking to the LLM (given)
// ---------------------------------------------------------------------------

// The LLM as the generator sees it: prompt + JSON Schema in, a not-yet-trusted object out
export type Llm = (prompt: string, jsonSchema: object) => Promise<unknown>;

// The part of `claude -p --output-format json` we use
const ClaudeEnvelopeSchema = z.object({
  is_error: z.boolean(),
  result: z.string().optional(),
  structured_output: z.unknown(),
});

export interface ClaudeCliOptions {
  cmd?: string; // default "claude"; the tests point it at a fake
  model?: string; // e.g. "sonnet"; default: whatever claude defaults to
  timeoutMs?: number;
}

// Runs the Claude Code CLI headless. Auth comes from the environment
// (CLAUDE_CODE_OAUTH_TOKEN on the Pi, your login on WSL), never from this code.
export function claudeCli(opts: ClaudeCliOptions = {}): Llm {
  const { cmd = "claude", model, timeoutMs = 180_000 } = opts;
  return (prompt, jsonSchema) =>
    new Promise((resolve, reject) => {
      const args = [
        "-p",
        prompt,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(jsonSchema),
        "--tools",
        "", // no tools: it only has to write text, not run anything
        "--no-session-persistence",
        ...(model ? ["--model", model] : []),
      ];
      // cwd: a neutral dir, so no project CLAUDE.md gets picked up
      const child = execFile(
        cmd,
        args,
        { cwd: tmpdir(), timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          // err.message would repeat the whole command line (prompt included); stderr says why
          if (err)
            return reject(
              new Error(
                `claude failed (${err.code ?? err.signal}): ${stderr.trim()}`,
              ),
            );
          try {
            const envelope = ClaudeEnvelopeSchema.parse(JSON.parse(stdout));
            if (envelope.is_error) {
              return reject(
                new Error(`claude: ${envelope.result ?? "unknown error"}`),
              );
            }
            resolve(envelope.structured_output);
          } catch (e) {
            reject(e);
          }
        },
      );
      child.stdin?.end(); // claude -p also reads stdin; an open pipe would make it wait forever
    });
}

// ---------------------------------------------------------------------------
// Part 3: generate → validate → retry (yours)
// ---------------------------------------------------------------------------

export class GenerationError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(
      `no valid exercise after ${reasons.length} attempt(s):\n- ${reasons.join("\n- ")}`,
    );
    this.name = "GenerationError";
    this.reasons = reasons;
  }
}

export interface GeneratorDeps {
  llm: Llm;
  checker: Checker;
  maxAttempts?: number; // default 2: every attempt costs a claude call
}

export function newExerciseId(lang: Language): string {
  return `${lang}-${randomUUID().slice(0, 8)}`;
}

export async function generateExercise(
  req: GenerationRequest,
  deps: GeneratorDeps,
): Promise<Exercise> {
  const errors: string[] = [];
  for (let index = 0; index < (deps.maxAttempts ?? 2); index++) {
    const promptResponse = await deps.llm(
      buildPrompt(req, errors.at(-1)),
      DRAFT_JSON_SCHEMA,
    );
    const parsedResponse = ExerciseDraftSchema.safeParse(promptResponse);
    if (!parsedResponse.success) {
      errors.push(`wrong shape: ${z.prettifyError(parsedResponse.error)}`);
      continue;
    }
    const { solution, starter, tests } = parsedResponse.data;
    const solutionResult = await deps.checker(req.lang, solution, tests);
    if (solutionResult.status !== "pass") {
      errors.push(
        `exercise unsolvable due to ${solutionResult.status} ${solutionResult.status === "timeout" ? "" : solutionResult.output}`,
      );
      continue;
    }
    const starterResult = await deps.checker(req.lang, starter, tests);
    if (
      starterResult.status !== "fail" &&
      starterResult.status !== "compile_error"
    ) {
      errors.push(
        `exercise passed test from the start or timed out status: ${starterResult.status}`,
      );
      continue;
    }
    return {
      ...parsedResponse.data,
      ...(req.topic !== undefined ? { prompt: req.topic } : {}),
      id: newExerciseId(req.lang),
      createdAt: new Date().toISOString(),
      lang: req.lang,
      difficulty: req.difficulty,
    };
  }
  throw new GenerationError(errors);
}
