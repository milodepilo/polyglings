import { describe, expect, it } from "vitest";
import {
  computeProgress,
  MAX_LEVEL,
  SOLVES_TO_LEVEL_UP,
  type SolvedExercise,
} from "../src/progress.js";
import type { Difficulty, Language } from "../src/types.js";

// solves(lang, [1, 1, 2]) → three solves, one minute apart, in that order
let minute = 0;
function solves(lang: Language, difficulties: Difficulty[]): SolvedExercise[] {
  return difficulties.map((difficulty) => ({
    lang,
    difficulty,
    solvedAt: new Date(Date.UTC(2026, 9, 20, 8, minute++)).toISOString(),
  }));
}

const start = { level: 1, towardNext: 0, solved: 0 };

describe("computeProgress", () => {
  it("starts every language at level 1 when nothing is solved", () => {
    expect(computeProgress([])).toStrictEqual({ cpp: start, js: start, ts: start });
  });

  it("counts solves toward the next level", () => {
    expect(computeProgress(solves("ts", [1, 1])).ts).toStrictEqual({
      level: 1,
      towardNext: 2,
      solved: 2,
    });
  });

  it(`levels up after ${SOLVES_TO_LEVEL_UP} solves at your level, and starts counting again`, () => {
    expect(SOLVES_TO_LEVEL_UP).toBe(3);
    expect(computeProgress(solves("ts", [1, 1, 1])).ts).toStrictEqual({
      level: 2,
      towardNext: 0,
      solved: 3,
    });
    expect(computeProgress(solves("ts", [1, 1, 1, 2])).ts).toMatchObject({ level: 2, towardNext: 1 });
  });

  it("keeps languages apart", () => {
    const p = computeProgress([...solves("cpp", [1, 1, 1]), ...solves("js", [1])]);
    expect(p.cpp).toMatchObject({ level: 2, towardNext: 0, solved: 3 });
    expect(p.js).toMatchObject({ level: 1, towardNext: 1, solved: 1 });
    expect(p.ts).toStrictEqual(start);
  });

  it("does not count solves below your current level toward the next one", () => {
    // reach level 2, then solve two old level-1 exercises: still level 2, nothing toward 3
    const p = computeProgress(solves("ts", [1, 1, 1, 1, 1])).ts;
    expect(p).toStrictEqual({ level: 2, towardNext: 0, solved: 5 });
  });

  it("does count solves above your current level", () => {
    expect(computeProgress(solves("ts", [3, 3])).ts).toMatchObject({ level: 1, towardNext: 2 });
  });

  it("uses your level at the moment of each solve", () => {
    // 1,1,1 → level 2; then 2,2 count; then the old 1 doesn't; then 2 → level 3
    const p = computeProgress(solves("js", [1, 1, 1, 2, 2, 1, 2])).js;
    expect(p).toStrictEqual({ level: 3, towardNext: 0, solved: 7 });
  });

  it("walks the solves in time order, even when the input isn't sorted", () => {
    // in time order: 1, 1, 1 (→ level 2), 2. Reversed, a naive loop would see the 2 first
    const p = computeProgress(solves("ts", [1, 1, 1, 2]).reverse()).ts;
    expect(p).toMatchObject({ level: 2, towardNext: 1 });
  });

  it("does not change the array it was given", () => {
    const input = solves("ts", [1, 1, 1, 2]).reverse();
    const copy = structuredClone(input);
    computeProgress(input);
    expect(input).toStrictEqual(copy);
  });

  it(`never goes above level ${MAX_LEVEL}, and stops counting there`, () => {
    const all: Difficulty[] = [];
    for (let level = 1; level <= 10; level++) all.push(...Array<Difficulty>(3).fill(level as Difficulty));
    const p = computeProgress(solves("cpp", [...all, 10, 10, 10, 10])).cpp;
    expect(p).toStrictEqual({ level: MAX_LEVEL, towardNext: 0, solved: 34 });
  });
});
