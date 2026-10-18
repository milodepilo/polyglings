import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store.js";
import type { Exercise } from "../src/types.js";

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

beforeEach(() => {
  // a fresh app + store per test, so tests can't influence each other
  app = buildApp(new MemoryStore([tsExercise, cppExercise]));
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

  it("returns 501 for a valid submission (runner comes in milestone 4)", async () => {
    const res = await submit("ts-0001", { code: "export function first() {}" });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toHaveProperty("error");
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
