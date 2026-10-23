import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/sqlite-store.js";
import { MemoryStore, type ExerciseStore, type Submission } from "../src/store.js";
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

  describe("submissions", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 21, 9, minute)).toISOString();
    const submit = (exerciseId: string, status: Submission["status"], minute: number) =>
      store.addSubmission({ exerciseId, status, submittedAt: at(minute) });
    const bySolvedAt = (xs: { solvedAt: string }[]) =>
      xs.toSorted((a, b) => a.solvedAt.localeCompare(b.solvedAt));

    it("has nothing solved at the start", () => {
      store = make();
      store.add(tsExercise);
      expect(store.listSolved()).toEqual([]);
    });

    it("lists a passed exercise with its lang, difficulty and the time of the pass", () => {
      store = make();
      store.add(tsExercise);
      submit("ts-0001", "pass", 5);
      expect(store.listSolved()).toStrictEqual([{ lang: "ts", difficulty: 2, solvedAt: at(5) }]);
    });

    it("ignores fail, timeout and compile_error", () => {
      store = make();
      store.add(tsExercise);
      submit("ts-0001", "fail", 1);
      submit("ts-0001", "timeout", 2);
      submit("ts-0001", "compile_error", 3);
      expect(store.listSolved()).toEqual([]);
    });

    it("lists an exercise once, dated by its FIRST pass (not the first one stored)", () => {
      store = make();
      store.add(tsExercise);
      submit("ts-0001", "fail", 1);
      submit("ts-0001", "pass", 30); // stored first...
      submit("ts-0001", "pass", 10); // ...but this one happened earlier
      submit("ts-0001", "pass", 20);
      expect(store.listSolved()).toStrictEqual([{ lang: "ts", difficulty: 2, solvedAt: at(10) }]);
    });

    it("lists every solved exercise", () => {
      store = make();
      store.add(tsExercise);
      store.add(cppExercise);
      store.add({ ...tsExercise, id: "ts-0002" }); // never passed
      submit("cpp-0001", "pass", 7);
      submit("ts-0001", "pass", 3);
      submit("ts-0002", "fail", 4);
      expect(bySolvedAt(store.listSolved())).toStrictEqual([
        { lang: "ts", difficulty: 2, solvedAt: at(3) },
        { lang: "cpp", difficulty: 5, solvedAt: at(7) },
      ]);
    });

    it("refuses a submission for an exercise that doesn't exist", () => {
      store = make();
      expect(() => submit("nope", "pass", 1)).toThrow();
      expect(store.listSolved()).toEqual([]);
    });
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

  it("keeps submissions too, and still refuses unknown exercises after reopening", () => {
    dir = mkdtempSync(join(tmpdir(), "polyglings-"));
    const file = join(dir, "test.db");
    const submittedAt = "2026-10-21T09:00:00.000Z";

    const first = new SqliteStore(file);
    first.add(cppExercise);
    first.addSubmission({ exerciseId: "cpp-0001", status: "pass", submittedAt });
    first.close();

    const second = new SqliteStore(file);
    expect(second.listSolved()).toStrictEqual([{ lang: "cpp", difficulty: 5, solvedAt: submittedAt }]);
    // the foreign key must hold for a reopened file too, not just a fresh table
    expect(() =>
      second.addSubmission({ exerciseId: "nope", status: "pass", submittedAt }),
    ).toThrow();
    second.close();
  });
});
