// The CLI's API client against the REAL server (buildApp from ../server), with a fake
// checker and generator. If the server changes a route, these tests break.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../server/src/app.js";
import { GenerationError, type GenerationRequest } from "../../server/src/generator.js";
import type { Checker } from "../../server/src/runner.js";
import { MemoryStore } from "../../server/src/store.js";
import type { CheckResult, Exercise } from "../../server/src/types.js";
import { ApiError, createApi, ServerUnreachableError } from "../src/api.js";

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
const cppExercise: Exercise = { ...tsExercise, id: "cpp-0001", lang: "cpp", prompt: "references" };

let store: MemoryStore;
let checkCalls: Parameters<Checker>[];
let checkResult: CheckResult;
let generateCalls: GenerationRequest[];
let generateError: Error | undefined;

let app: ReturnType<typeof buildApp>; // fastify itself is a dependency of server/, not of cli/
let baseUrl: string; // e.g. http://127.0.0.1:41235

beforeAll(async () => {
  app = buildApp({
    // a getter-like wrapper: each test gets a fresh store, the app keeps the same object
    store: {
      get: (id) => store.get(id),
      list: (filter) => store.list(filter),
      add: (e) => store.add(e),
      addSubmission: (s) => store.addSubmission(s),
      listSolved: () => store.listSolved(),
      listOpen: () => store.listOpen(),
    },
    checker: async (...args) => {
      checkCalls.push(args);
      return checkResult;
    },
    generate: async (req) => {
      generateCalls.push(req);
      if (generateError) throw generateError;
      return { ...tsExercise, id: "gen-1", lang: req.lang, ...(req.topic ? { topic: req.topic } : {}) };
    },
  });
  baseUrl = await app.listen({ port: 0, host: "127.0.0.1" }); // port 0: any free port
});
afterAll(() => app.close());

beforeEach(() => {
  store = new MemoryStore([tsExercise, cppExercise]);
  checkCalls = [];
  checkResult = { status: "pass" };
  generateCalls = [];
  generateError = undefined;
});

describe("createApi against the real server", () => {
  it("lists exercises, all or per language", async () => {
    const api = createApi(baseUrl);
    expect((await api.list()).map((e) => e.id).sort()).toEqual(["cpp-0001", "ts-0001"]);
    expect(await api.list("cpp")).toStrictEqual([cppExercise]);
  });

  it("gets one exercise, exactly as stored", async () => {
    const api = createApi(baseUrl);
    expect(await api.get("ts-0001")).toStrictEqual(tsExercise);
    expect(await api.get("cpp-0001")).toStrictEqual(cppExercise);
  });

  it("works with or without a trailing slash on the base URL", async () => {
    expect(await createApi(`${baseUrl}/`).get("ts-0001")).toStrictEqual(tsExercise);
  });

  it("submits code as JSON and returns the check result", async () => {
    checkResult = { status: "fail", output: "expected 1, got undefined" };
    const api = createApi(baseUrl);
    expect(await api.submit("ts-0001", "export const x = 1;")).toStrictEqual(checkResult);
    expect(checkCalls).toEqual([["ts", "export const x = 1;", "// tests"]]);
  });

  it("generates, with and without a topic", async () => {
    const api = createApi(baseUrl);
    expect(await api.generate("js")).toMatchObject({ id: "gen-1", lang: "js" });
    expect(await api.generate("cpp", "templates")).toMatchObject({ lang: "cpp", topic: "templates" });
    expect(generateCalls).toStrictEqual([
      { lang: "js", difficulty: 1 },
      { lang: "cpp", difficulty: 1, topic: "templates" },
    ]);
  });

  it("gets your progress", async () => {
    const start = { level: 1, towardNext: 0, solved: 0 };
    expect(await createApi(baseUrl).progress()).toStrictEqual({ cpp: start, ts: start, js: start });
  });

  it("throws an ApiError with the status and the JSON body when the server says no", async () => {
    const api = createApi(baseUrl);
    const err = await api.get("nope").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, body: { error: "exercise not found" } });
    expect((err as ApiError).message).toBe("server answered 404: exercise not found");

    await expect(api.submit("ts-0001", "")).rejects.toMatchObject({ status: 400 }); // empty code
  });

  it("keeps the generator's reasons on a 502", async () => {
    generateError = new GenerationError(["starter already passes", "solution fails"]);
    await expect(createApi(baseUrl).generate("ts")).rejects.toMatchObject({
      status: 502,
      body: { error: "no exercise generated", reasons: ["starter already passes", "solution fails"] },
    });
  });

  it("throws ServerUnreachableError when nobody answers, with the original error as cause", async () => {
    const err = await createApi("http://127.0.0.1:1").progress().catch((e: unknown) => e); // port 1: nothing there
    expect(err).toBeInstanceOf(ServerUnreachableError);
    expect((err as Error).message).toBe("cannot reach the server at http://127.0.0.1:1");
    expect((err as Error).cause).toBeInstanceOf(Error);
  });
});

// Answers the real server never gives, so a fake fetch
describe("createApi with a fake fetch", () => {
  const fakeFetch = (response: Response): typeof fetch => async () => response;

  it("keeps a non-JSON error body as text (e.g. a proxy's HTML error page)", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    const api = createApi("http://pi:3000", fakeFetch(new Response(html, { status: 502 })));
    const err = await api.progress().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 502, body: html, message: "server answered 502" });
  });

  it("refuses a 200 answer with the wrong shape instead of passing it on", async () => {
    const wrong = Response.json([{ id: "ts-0001", lang: "python" }]);
    await expect(createApi("http://pi:3000", fakeFetch(wrong)).list()).rejects.toThrow();
  });
});
