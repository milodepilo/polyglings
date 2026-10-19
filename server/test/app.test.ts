import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, type Checker } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import type { CheckResult, Exercise } from "../src/types.js";

const tsExercise: Exercise = {
  id: "ts-0001",
  lang: "ts",
  topic: "generics",
  difficulty: 2,
  description: "Write first<T>.",
  starter: "export function first(xs) {}",
  tests: "// tests",
  hint: "Use <T>.",
  solution: "export function first<T>(xs: T[]) { return xs[0]; }",
  createdAt: "2026-10-17T07:00:00.000Z",
};
const cppExercise: Exercise = {
  ...tsExercise,
  id: "cpp-0001",
  lang: "cpp",
  topic: "references",
  starter: "int main() {}",
  solution: "int main() { return 0; }",
};

let app: FastifyInstance;

// fake runner: records what it was called with and returns whatever checkResult is set to
let checkCalls: Parameters<Checker>[];
let checkResult: CheckResult;
const fakeCheck: Checker = async (...args) => {
  checkCalls.push(args);
  return checkResult;
};

beforeEach(() => {
  // a fresh app + store per test, so tests can't influence each other
  checkCalls = [];
  checkResult = { status: "pass" };
  app = buildApp(new MemoryStore([tsExercise, cppExercise]), {}, fakeCheck);
});

afterEach(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns 200 { ok: true }", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("GET /exercises", () => {
  it("lists all exercises", async () => {
    const res = await app.inject({ method: "GET", url: "/exercises" });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as Exercise[]).map((e) => e.id).sort();
    expect(ids).toEqual(["cpp-0001", "ts-0001"]);
  });

  it("filters by ?lang=", async () => {
    const res = await app.inject({ method: "GET", url: "/exercises?lang=cpp" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Exercise[]).map((e) => e.id)).toEqual(["cpp-0001"]);
  });

  it("rejects an unknown language with 400", async () => {
    const res = await app.inject({ method: "GET", url: "/exercises?lang=python" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error");
  });
});

describe("GET /exercises/:id", () => {
  it("returns the exercise", async () => {
    const res = await app.inject({ method: "GET", url: "/exercises/ts-0001" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(tsExercise);
  });

  it("returns 404 with an error for an unknown id", async () => {
    const res = await app.inject({ method: "GET", url: "/exercises/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toHaveProperty("error");
  });
});

describe("POST /exercises/:id/submit", () => {
  const submit = (id: string, payload: unknown) =>
    app.inject({ method: "POST", url: `/exercises/${id}/submit`, payload: payload as object });

  it("rejects a missing or empty code field with 400", async () => {
    for (const body of [{}, { code: "" }, { code: 42 }]) {
      const res = await submit("ts-0001", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toHaveProperty("error");
    }
  });

  it("returns 404 for an unknown exercise", async () => {
    const res = await submit("nope", { code: "x" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toHaveProperty("error");
  });

  it("does not run the checker for a 400 or a 404", async () => {
    await submit("ts-0001", {});
    await submit("nope", { code: "x" });
    expect(checkCalls).toEqual([]);
  });

  it("checks the submitted code against the exercise's lang and tests", async () => {
    const code = "export function first<T>(xs: T[]) { return xs[0]; }";
    await submit("ts-0001", { code });
    expect(checkCalls).toEqual([["ts", code, tsExercise.tests]]);
  });

  it("answers 200 with the CheckResult, for every status", async () => {
    const results: CheckResult[] = [
      { status: "pass" },
      { status: "fail", output: "AssertionError: 1 !== 2" },
      { status: "timeout" },
      { status: "compile_error", output: "error: expected ';'" },
    ];
    for (const result of results) {
      checkResult = result;
      const res = await submit("cpp-0001", { code: "int main() {}" });
      expect(res.statusCode, result.status).toBe(200);
      expect(res.json()).toEqual(result);
    }
  });

  it("answers 500 when the checker itself fails (e.g. g++ not installed)", async () => {
    const broken = buildApp(new MemoryStore([cppExercise]), {}, async () => {
      throw new Error("spawn g++ ENOENT");
    });
    const res = await broken.inject({
      method: "POST",
      url: "/exercises/cpp-0001/submit",
      payload: { code: "int main() {}" },
    });
    await broken.close();
    expect(res.statusCode).toBe(500);
  });

  it("uses the real runner when no checker is passed", async () => {
    const jsExercise: Exercise = {
      ...tsExercise,
      id: "js-0001",
      lang: "js",
      tests: [
        'import assert from "node:assert";',
        'import { double } from "./main.js";',
        "assert.equal(double(21), 42);",
      ].join("\n"),
    };
    const real = buildApp(new MemoryStore([jsExercise]));
    const send = (code: string) =>
      real.inject({ method: "POST", url: "/exercises/js-0001/submit", payload: { code } });
    try {
      expect((await send("export const double = (n) => n * 2;")).json()).toEqual({ status: "pass" });
      expect((await send("export const double = (n) => n;")).json()).toMatchObject({ status: "fail" });
    } finally {
      await real.close();
    }
  });
});

describe("POST /exercises/generate", () => {
  const generate = (payload: unknown) =>
    app.inject({ method: "POST", url: "/exercises/generate", payload: payload as object });

  it("rejects a bad body with 400", async () => {
    for (const body of [{}, { lang: "rust" }, { lang: "ts", topic: "" }]) {
      const res = await generate(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toHaveProperty("error");
    }
  });

  it("returns 501 for a valid request (generator comes in milestone 5)", async () => {
    const res = await generate({ lang: "ts", topic: "generics" });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toHaveProperty("error");
  });
});
