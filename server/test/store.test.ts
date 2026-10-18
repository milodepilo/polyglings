import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/sqlite-store.js";
import { MemoryStore, type ExerciseStore } from "../src/store.js";
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
  difficulty: 5,
  createdAt: "2026-10-17T08:00:00.000Z",
  prompt: "something with references", // the only exercise WITH a prompt
};

const ids = (xs: Exercise[]) => xs.map((e) => e.id).sort();

// The same contract, run against every implementation. If MemoryStore passes and
// SqliteStore doesn't, the bug is in SqliteStore, not in the test.
const stores: [string, () => ExerciseStore & { close?: () => void }][] = [
  ["MemoryStore", () => new MemoryStore()],
  ["SqliteStore", () => new SqliteStore(":memory:")],
];

describe.each(stores)("%s", (_, make) => {
  let store: ReturnType<typeof make>;
  afterEach(() => store?.close?.());

  it("returns undefined for an unknown id", () => {
    store = make();
    expect(store.get("nope")).toBeUndefined();
  });

  it("gets back exactly what was added (no extra keys, no null prompt)", () => {
    store = make();
    store.add(tsExercise);
    store.add(cppExercise);
    // toStrictEqual: { prompt: null } or { prompt: undefined } is NOT equal to a missing prompt
    expect(store.get("ts-0001")).toStrictEqual(tsExercise);
    expect(store.get("cpp-0001")).toStrictEqual(cppExercise);
  });

  it("replaces an exercise when the same id is added again", () => {
    store = make();
    store.add(tsExercise);
    store.add({ ...tsExercise, topic: "conditional types" });
    expect(store.get("ts-0001")?.topic).toBe("conditional types");
    expect(store.list()).toHaveLength(1);
  });

  it("lists all exercises, or only one language", () => {
    store = make();
    expect(store.list()).toEqual([]);
    store.add(tsExercise);
    store.add(cppExercise);
    expect(ids(store.list())).toEqual(["cpp-0001", "ts-0001"]);
    expect(ids(store.list({ lang: "cpp" }))).toEqual(["cpp-0001"]);
    expect(store.list({ lang: "js" })).toEqual([]);
  });

  it("is not fooled by SQL in the input", () => {
    store = make();
    store.add(tsExercise);
    expect(store.get("x' OR '1'='1")).toBeUndefined();
  });
});

describe("SqliteStore on disk", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps exercises after closing and reopening the file", () => {
    dir = mkdtempSync(join(tmpdir(), "polyglings-"));
    const file = join(dir, "test.db");

    const first = new SqliteStore(file);
    first.add(cppExercise);
    first.close();

    const second = new SqliteStore(file); // must not fail: the table already exists
    expect(second.get("cpp-0001")).toStrictEqual(cppExercise);
    second.close();
  });
});
