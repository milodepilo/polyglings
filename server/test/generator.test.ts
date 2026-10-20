import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildPrompt,
  claudeCli,
  DRAFT_JSON_SCHEMA,
  type ExerciseDraft,
  generateExercise,
  GenerationError,
  type GenerationRequest,
  type Llm,
} from "../src/generator.js";
import { check, type Checker } from "../src/runner.js";
import { ExerciseSchema } from "../src/schemas.js";
import type { CheckResult } from "../src/types.js";

const draft: ExerciseDraft = {
  topic: "generics",
  description: "Write `first<T>`.",
  starter: "export function first(xs) { /* TODO */ }",
  tests: "// tests for first",
  hint: "Use a type parameter.",
  solution: "export function first<T>(xs: T[]) { return xs[0]; }",
};
const req: GenerationRequest = { lang: "ts", difficulty: 3, topic: "generics" };

// fake LLM: hands out the queued answers one by one, records every prompt
let llmAnswers: unknown[];
let prompts: string[];
let schemas: object[];
const fakeLlm: Llm = async (prompt, schema) => {
  prompts.push(prompt);
  schemas.push(schema);
  if (llmAnswers.length === 0) throw new Error("fake llm: no more answers queued");
  return llmAnswers.shift();
};

// fake checker: the result per piece of code; anything unknown counts as "pass"
let results: Map<string, CheckResult>;
let checkCalls: Parameters<Checker>[];
const fakeCheck: Checker = async (...args) => {
  checkCalls.push(args);
  return results.get(args[1]) ?? { status: "pass" };
};

beforeEach(() => {
  llmAnswers = [draft];
  prompts = [];
  schemas = [];
  results = new Map([[draft.starter, { status: "fail", output: "AssertionError" }]]);
  checkCalls = [];
});

const generate = (r: GenerationRequest = req, maxAttempts?: number) =>
  generateExercise(r, {
    llm: fakeLlm,
    checker: fakeCheck,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  });

describe("generateExercise: a good draft", () => {
  it("returns a complete, valid Exercise built from the draft and the request", async () => {
    const before = Date.now();
    const ex = await generate();
    expect(ExerciseSchema.parse(ex)).toEqual(ex);
    expect(ex).toMatchObject({ ...draft, lang: "ts", difficulty: 3 });
    expect(ex.id).toMatch(/^ts-[0-9a-f]{8}$/);
    const created = Date.parse(ex.createdAt);
    expect(created).toBeGreaterThanOrEqual(before - 1000);
    expect(created).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("asks the llm once, with buildPrompt(req) and DRAFT_JSON_SCHEMA", async () => {
    await generate();
    expect(prompts).toEqual([buildPrompt(req)]);
    expect(schemas).toEqual([DRAFT_JSON_SCHEMA]);
  });

  it("checks the solution and the starter against the draft's tests", async () => {
    await generate();
    expect(checkCalls).toContainEqual(["ts", draft.solution, draft.tests]);
    expect(checkCalls).toContainEqual(["ts", draft.starter, draft.tests]);
    expect(checkCalls).toHaveLength(2);
  });

  it("stores the requested topic as prompt, and leaves prompt out without one", async () => {
    expect((await generate()).prompt).toBe("generics");
    llmAnswers = [draft];
    const ex = await generate({ lang: "ts", difficulty: 3 });
    expect(Object.hasOwn(ex, "prompt")).toBe(false);
  });

  it("keeps the llm's topic; the requested topic only goes into prompt", async () => {
    llmAnswers = [{ ...draft, topic: "Generic functions: first and last" }];
    const ex = await generate({ lang: "ts", difficulty: 3, topic: "generics" });
    expect(ex.topic).toBe("Generic functions: first and last");
    expect(ex.prompt).toBe("generics");
  });

  it("accepts a starter that does not compile", async () => {
    results.set(draft.starter, { status: "compile_error", output: "error: ..." });
    await expect(generate({ lang: "cpp", difficulty: 1 })).resolves.toMatchObject({ lang: "cpp" });
  });

  it("gives every exercise a new id", async () => {
    llmAnswers = [draft, draft];
    const a = await generate();
    const b = await generate();
    expect(a.id).not.toBe(b.id);
  });
});

describe("generateExercise: bad drafts are retried", () => {
  const fixed: ExerciseDraft = { ...draft, solution: "export const first = (xs) => xs[0];" };

  it("retries an answer that doesn't match the draft schema, without checking it", async () => {
    llmAnswers = [{ topic: "generics" }, draft];
    const ex = await generate();
    expect(ex.solution).toBe(draft.solution);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).not.toBe(prompts[0]); // the 2nd prompt says what was wrong
    expect(checkCalls.map((c) => c[1])).not.toContain(undefined);
    expect(checkCalls).toHaveLength(2); // only the 2nd draft was run
  });

  it("retries when the solution fails, and feeds the test output back", async () => {
    results.set(draft.solution, { status: "fail", output: "AssertionError: boom" });
    llmAnswers = [draft, fixed];
    const ex = await generate();
    expect(ex.solution).toBe(fixed.solution);
    expect(prompts[1]).toContain("AssertionError: boom");
  });

  it("retries when the solution doesn't compile, and feeds the compiler output back", async () => {
    results.set(draft.solution, { status: "compile_error", output: "error: expected ';'" });
    llmAnswers = [draft, fixed];
    await generate();
    expect(prompts[1]).toContain("error: expected ';'");
  });

  it("retries when the solution times out", async () => {
    results.set(draft.solution, { status: "timeout" });
    llmAnswers = [draft, fixed];
    expect((await generate()).solution).toBe(fixed.solution);
    expect(prompts[1]).not.toBe(prompts[0]);
  });

  it("retries when the starter already passes", async () => {
    results.delete(draft.starter); // → "pass"
    const better: ExerciseDraft = { ...draft, starter: "export function first(xs) { return 42; }" };
    results.set(better.starter, { status: "fail", output: "AssertionError" });
    llmAnswers = [draft, better];
    expect((await generate()).starter).toBe(better.starter);
    expect(prompts[1]).not.toBe(prompts[0]);
  });

  it("retries when the starter times out", async () => {
    results.set(draft.starter, { status: "timeout" });
    const better: ExerciseDraft = { ...draft, starter: "export function first(xs) { return 42; }" };
    results.set(better.starter, { status: "fail", output: "AssertionError" });
    llmAnswers = [draft, better];
    expect((await generate()).starter).toBe(better.starter);
  });
});

describe("generateExercise: giving up", () => {
  beforeEach(() => {
    results.set(draft.solution, { status: "fail", output: "AssertionError: boom" });
    llmAnswers = [draft, draft, draft, draft];
  });

  it("throws a GenerationError with one reason per attempt after 2 attempts", async () => {
    const err = await generate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).reasons).toHaveLength(2);
    expect(prompts).toHaveLength(2);
  });

  it("respects maxAttempts", async () => {
    const err = await generate(req, 3).catch((e: unknown) => e);
    expect((err as GenerationError).reasons).toHaveLength(3);
    expect(prompts).toHaveLength(3);
  });

  it("does not retry when the llm itself fails (auth, network): that error comes through", async () => {
    const down: Llm = async (prompt) => {
      prompts.push(prompt);
      throw new Error("claude: not logged in");
    };
    await expect(generateExercise(req, { llm: down, checker: fakeCheck })).rejects.toThrow(
      "claude: not logged in",
    );
    expect(prompts).toHaveLength(1);
  });
});

describe("generateExercise with the real runner", () => {
  const jsDraft: ExerciseDraft = {
    topic: "arrow functions",
    description: "Write `double`.",
    starter: "export const double = (n) => 0; // TODO",
    tests: [
      'import assert from "node:assert/strict";',
      'import { double } from "./main.js";',
      "assert.equal(double(21), 42);",
    ].join("\n"),
    hint: "Multiply.",
    solution: "export const double = (n) => n * 2;",
  };

  it("accepts a draft that really works", async () => {
    llmAnswers = [jsDraft];
    const ex = await generateExercise({ lang: "js", difficulty: 1 }, { llm: fakeLlm, checker: check });
    expect(ex.solution).toBe(jsDraft.solution);
  });

  it("rejects a draft whose solution really fails", async () => {
    llmAnswers = [
      { ...jsDraft, solution: "export const double = (n) => n;" },
      { ...jsDraft, solution: "export const double = (n) => n + 1;" },
    ];
    await expect(
      generateExercise({ lang: "js", difficulty: 1 }, { llm: fakeLlm, checker: check }),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});

// claudeCli is given code; these tests pin down how it talks to the CLI, using a fake `claude`
describe("claudeCli (with a fake claude)", () => {
  let dir: string;
  let fake: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "fake-claude-"));
    fake = join(dir, "claude.mjs"); // .mjs: an ES module, so top-level await works
    // reads stdin to the end (hangs if it's left open), then answers based on the prompt
    await writeFile(
      fake,
      `#!${process.execPath}
let stdin = "";
for await (const chunk of process.stdin) stdin += chunk;
const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1];
if (prompt === "exit 3") process.exit(3);
if (prompt === "garbage") { console.log("not json"); process.exit(0); }
console.log(JSON.stringify({
  type: "result",
  is_error: prompt === "error",
  result: prompt === "error" ? "Invalid API key" : "ok",
  structured_output: { args, stdin },
}));
`,
    );
    await chmod(fake, 0o755);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns structured_output and passes the prompt, schema and flags", async () => {
    const llm = claudeCli({ cmd: fake, timeoutMs: 5000 });
    const out = (await llm("hello", DRAFT_JSON_SCHEMA)) as { args: string[]; stdin: string };
    const { args } = out;
    expect(args.slice(0, 2)).toEqual(["-p", "hello"]);
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1]!)).toEqual(DRAFT_JSON_SCHEMA);
    expect(args[args.indexOf("--tools") + 1]).toBe("");
    expect(args).not.toContain("--model");
    expect(out.stdin).toBe("");
  });

  it("passes --model when given", async () => {
    const out = (await claudeCli({ cmd: fake, model: "sonnet", timeoutMs: 5000 })("hi", {})) as {
      args: string[];
    };
    expect(out.args[out.args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("rejects on is_error, a non-zero exit, or output that isn't JSON", async () => {
    const llm = claudeCli({ cmd: fake, timeoutMs: 5000 });
    await expect(llm("error", {})).rejects.toThrow("Invalid API key");
    await expect(llm("exit 3", {})).rejects.toThrow();
    await expect(llm("garbage", {})).rejects.toThrow();
  });
});
