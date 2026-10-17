import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  ExerciseSchema,
  GenerateRequestSchema,
  SubmitRequestSchema,
} from "../src/schemas.js";
import type { Exercise, Language } from "../src/types.js";

const valid: Exercise = {
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
};

describe("ExerciseSchema", () => {
  it("infers exactly the Exercise interface (schema and type agree)", () => {
    expectTypeOf<z.infer<typeof ExerciseSchema>>().toEqualTypeOf<Exercise>();
  });

  it("accepts a valid exercise, with or without prompt", () => {
    expect(ExerciseSchema.safeParse(valid).success).toBe(true);
    expect(
      ExerciseSchema.safeParse({ ...valid, prompt: "give me generics" }).success,
    ).toBe(true);
  });

  it.each([
    ["unknown language", { lang: "python" }],
    ["difficulty above 10", { difficulty: 12 }],
    ["difficulty below 1", { difficulty: 0 }],
    ["non-integer difficulty", { difficulty: 2.5 }],
    ["createdAt that is not an ISO datetime", { createdAt: "yesterday" }],
    ["empty starter", { starter: "" }],
    ["empty solution", { solution: "" }],
  ])("rejects %s", (_, patch) => {
    expect(ExerciseSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    const { hint: _, ...noHint } = valid;
    expect(ExerciseSchema.safeParse(noHint).success).toBe(false);
  });
});

describe("GenerateRequestSchema", () => {
  it("infers { lang: Language; topic?: string }", () => {
    expectTypeOf<z.infer<typeof GenerateRequestSchema>>().toEqualTypeOf<{
      lang: Language;
      topic?: string;
    }>();
  });

  it("accepts a language with or without topic", () => {
    expect(GenerateRequestSchema.safeParse({ lang: "cpp" }).success).toBe(true);
    expect(
      GenerateRequestSchema.safeParse({ lang: "ts", topic: "generics" }).success,
    ).toBe(true);
  });

  it("rejects a bad language, an empty topic and a topic over 200 chars", () => {
    expect(GenerateRequestSchema.safeParse({ lang: "rust" }).success).toBe(false);
    expect(GenerateRequestSchema.safeParse({ lang: "ts", topic: "" }).success).toBe(false);
    expect(
      GenerateRequestSchema.safeParse({ lang: "ts", topic: "x".repeat(201) }).success,
    ).toBe(false);
  });
});

describe("SubmitRequestSchema", () => {
  it("infers { code: string }", () => {
    expectTypeOf<z.infer<typeof SubmitRequestSchema>>().toEqualTypeOf<{
      code: string;
    }>();
  });

  it("accepts code up to 100_000 chars, rejects empty or larger", () => {
    expect(SubmitRequestSchema.safeParse({ code: "int main() {}" }).success).toBe(true);
    expect(SubmitRequestSchema.safeParse({ code: "x".repeat(100_000) }).success).toBe(true);
    expect(SubmitRequestSchema.safeParse({ code: "" }).success).toBe(false);
    expect(SubmitRequestSchema.safeParse({ code: "x".repeat(100_001) }).success).toBe(false);
    expect(SubmitRequestSchema.safeParse({}).success).toBe(false);
  });
});
