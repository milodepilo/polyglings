import { describe, expect, expectTypeOf, it } from "vitest";
import {
  LANGUAGES,
  isLanguage,
  type CheckResult,
  type Difficulty,
  type Exercise,
  type Language,
} from "../src/types.js";

describe("Language", () => {
  it("is exactly cpp | js | ts", () => {
    expectTypeOf<Language>().toEqualTypeOf<"cpp" | "js" | "ts">();
    expect([...LANGUAGES].sort()).toEqual(["cpp", "js", "ts"]);
  });

  it("isLanguage narrows a string", () => {
    expect(isLanguage("ts")).toBe(true);
    expect(isLanguage("python")).toBe(false);
    const s: string = "cpp";
    if (isLanguage(s)) expectTypeOf(s).toEqualTypeOf<Language>();
  });
});

describe("Difficulty", () => {
  it("only allows 1 through 10", () => {
    expectTypeOf<1>().toMatchTypeOf<Difficulty>();
    expectTypeOf<10>().toMatchTypeOf<Difficulty>();
    // @ts-expect-error 0 is not a difficulty
    const zero: Difficulty = 0;
    // @ts-expect-error 11 is not a difficulty
    const eleven: Difficulty = 11;
    void zero, void eleven;
  });
});

describe("Exercise", () => {
  const base = {
    id: "ts-0001",
    lang: "ts",
    topic: "generics",
    difficulty: 3,
    description: "Write a generic identity function.",
    starter: "export function id() {}",
    tests: "import { id } from './main'; ...",
    hint: "Use a type parameter <T>.",
    solution: "export function id<T>(x: T): T { return x; }",
    createdAt: "2026-10-16T07:00:00.000Z",
  } satisfies Exercise;

  it("accepts a complete exercise, prompt is optional", () => {
    expectTypeOf(base).toMatchTypeOf<Exercise>();
    const withPrompt: Exercise = { ...base, prompt: "give me generics" };
    expect(withPrompt.prompt).toBe("give me generics");
  });

  it("rejects a wrong language", () => {
    // @ts-expect-error python is not a Language
    const bad: Exercise = { ...base, lang: "python" };
    void bad;
  });
});

describe("CheckResult", () => {
  it("is a discriminated union on status", () => {
    expectTypeOf<CheckResult["status"]>().toEqualTypeOf<
      "pass" | "fail" | "compile_error" | "timeout"
    >();
  });

  it("only failing results with output carry output", () => {
    const r = { status: "fail", output: "expected 3, got 4" } as CheckResult;
    if (r.status === "fail" || r.status === "compile_error") {
      expectTypeOf(r.output).toBeString();
    }
    // @ts-expect-error a pass has no output
    const pass: CheckResult = { status: "pass", output: "x" };
    void pass;
  });
});
