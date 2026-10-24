import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationError, type GenerationRequest } from "../src/generator.js";
import { msUntilNext, runDaily, startScheduler } from "../src/scheduler.js";
import { MemoryStore } from "../src/store.js";
import type { Exercise, Language } from "../src/types.js";

// The Pi's time zone. Set before any Date is made, so "07:00" means 07:00 in Amsterdam
// on every machine that runs these tests (Node picks up a changed TZ right away).
process.env.TZ = "Europe/Amsterdam";

const base: Exercise = {
  id: "ts-0001",
  lang: "ts",
  topic: "generics",
  difficulty: 1,
  description: "Write first<T>.",
  starter: "export function first(xs) {}",
  tests: "// tests",
  hint: "Use <T>.",
  solution: "export function first<T>(xs: T[]) { return xs[0]; }",
  createdAt: "2026-10-17T07:00:00.000Z",
};

// fake generator: records every request; throws for the languages in `failFor`
function fakeGenerate(failFor: Partial<Record<Language, unknown>> = {}) {
  const calls: GenerationRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const generate = async (req: GenerationRequest): Promise<Exercise> => {
    calls.push(req);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5)); // a "slow" claude call
    inFlight--;
    if (req.lang in failFor) throw failFor[req.lang];
    return { ...base, id: `${req.lang}-gen-${calls.length}`, lang: req.lang, difficulty: req.difficulty };
  };
  return { generate, calls, maxInFlight: () => maxInFlight };
}

// an exercise that is already solved (so it isn't open)
function addSolved(store: MemoryStore, id: string, lang: Language, minute: number) {
  store.add({ ...base, id, lang });
  store.addSubmission({
    exerciseId: id,
    status: "pass",
    submittedAt: new Date(Date.UTC(2026, 9, 22, 8, minute)).toISOString(),
  });
}

describe("runDaily", () => {
  it("skips only the languages that still have something open, and says how many", async () => {
    const store = new MemoryStore([base, { ...base, id: "ts-0002" }, { ...base, id: "js-0001", lang: "js" }]);
    addSolved(store, "cpp-0001", "cpp", 1); // solved: cpp has nothing open
    const fake = fakeGenerate();
    const result = await runDaily({ store, generate: fake.generate });
    expect(fake.calls).toStrictEqual([{ lang: "cpp", difficulty: 1 }]);
    expect(result).toStrictEqual({
      added: [expect.objectContaining({ lang: "cpp" })],
      failed: [],
      skipped: [
        { lang: "ts", open: 2 },
        { lang: "js", open: 1 },
      ],
    });
  });

  it("generates one exercise per language at level 1 for a fresh start", async () => {
    const store = new MemoryStore();
    const fake = fakeGenerate();
    const result = await runDaily({ store, generate: fake.generate });
    // no topic key at all: the LLM picks one
    expect(fake.calls).toStrictEqual([
      { lang: "cpp", difficulty: 1 },
      { lang: "ts", difficulty: 1 },
      { lang: "js", difficulty: 1 },
    ]);
    expect(result).toStrictEqual({
      added: [
        expect.objectContaining({ id: "cpp-gen-1" }),
        expect.objectContaining({ id: "ts-gen-2" }),
        expect.objectContaining({ id: "js-gen-3" }),
      ],
      failed: [],
      skipped: [],
    });
  });

  it("stores what it generated, so running it twice in a row skips everything the second time", async () => {
    const store = new MemoryStore();
    const fake = fakeGenerate();
    await runDaily({ store, generate: fake.generate });
    expect(store.list().map((e) => e.id).sort()).toEqual(["cpp-gen-1", "js-gen-3", "ts-gen-2"]);
    expect(await runDaily({ store, generate: fake.generate })).toStrictEqual({
      added: [],
      failed: [],
      skipped: [
        { lang: "cpp", open: 1 },
        { lang: "ts", open: 1 },
        { lang: "js", open: 1 },
      ],
    });
    expect(fake.calls).toHaveLength(3); // not 6
  });

  it("uses your current level per language", async () => {
    const store = new MemoryStore();
    addSolved(store, "ts-0001", "ts", 1);
    addSolved(store, "ts-0002", "ts", 2);
    addSolved(store, "ts-0003", "ts", 3); // 3 level-1 ts solves → ts is level 2
    addSolved(store, "js-0001", "js", 4); // 1 js solve → js is still level 1
    const fake = fakeGenerate();
    await runDaily({ store, generate: fake.generate });
    expect(fake.calls).toStrictEqual([
      { lang: "cpp", difficulty: 1 },
      { lang: "ts", difficulty: 2 },
      { lang: "js", difficulty: 1 },
    ]);
  });

  it("keeps going when one language fails, reports why, and retries only that one next time", async () => {
    const store = new MemoryStore();
    const failing = fakeGenerate({ ts: new GenerationError(["starter already passes"]) });
    const result = await runDaily({ store, generate: failing.generate });
    expect(failing.calls.map((c) => c.lang)).toEqual(["cpp", "ts", "js"]); // js still tried
    expect(result).toStrictEqual({
      added: [expect.objectContaining({ lang: "cpp" }), expect.objectContaining({ lang: "js" })],
      failed: [{ lang: "ts", reason: expect.stringContaining("starter already passes") }],
      skipped: [],
    });
    expect(store.list().map((e) => e.lang).sort()).toEqual(["cpp", "js"]); // the failure isn't stored

    const working = fakeGenerate();
    await runDaily({ store, generate: working.generate });
    expect(working.calls).toStrictEqual([{ lang: "ts", difficulty: 1 }]); // cpp and js are open
  });

  it("also survives errors that aren't GenerationErrors, even values that aren't Errors", async () => {
    const store = new MemoryStore();
    const fake = fakeGenerate({ cpp: new Error("claude: not logged in"), js: "boom" });
    const result = await runDaily({ store, generate: fake.generate });
    expect(result).toStrictEqual({
      added: [expect.objectContaining({ lang: "ts" })],
      failed: [
        { lang: "cpp", reason: "claude: not logged in" },
        { lang: "js", reason: "boom" },
      ],
      skipped: [],
    });
  });

  it("generates one at a time, not all at once (the Pi has 4 cores and one claude login)", async () => {
    const store = new MemoryStore();
    const fake = fakeGenerate();
    await runDaily({ store, generate: fake.generate });
    expect(fake.maxInFlight()).toBe(1);
  });
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// local time in Europe/Amsterdam (months are 0-based: 9 = October)
const local = (y: number, mo: number, d: number, h: number, mi = 0, s = 0, ms = 0) =>
  new Date(y, mo, d, h, mi, s, ms);

describe("msUntilNext", () => {
  it("runs Node in the Pi's time zone (sanity check for the tests below)", () => {
    expect(local(2026, 9, 24, 7).toISOString()).toBe("2026-10-24T05:00:00.000Z"); // CEST = UTC+2
  });

  it("counts down to the hour later today", () => {
    expect(msUntilNext(7, local(2026, 9, 21, 6, 30))).toBe(30 * MINUTE);
    expect(msUntilNext(7, local(2026, 9, 21, 6, 59, 59, 999))).toBe(1);
  });

  it("goes to tomorrow when the hour has passed today", () => {
    expect(msUntilNext(7, local(2026, 9, 21, 8))).toBe(23 * HOUR);
    expect(msUntilNext(7, local(2026, 9, 21, 7, 0, 0, 1))).toBe(24 * HOUR - 1);
  });

  it("goes to tomorrow at exactly the hour, never 0 (or the job would fire again right away)", () => {
    expect(msUntilNext(7, local(2026, 9, 21, 7))).toBe(24 * HOUR);
  });

  it("works for other hours, including midnight", () => {
    expect(msUntilNext(0, local(2026, 9, 21, 23, 30))).toBe(30 * MINUTE);
    expect(msUntilNext(23, local(2026, 9, 21, 22))).toBe(1 * HOUR);
  });

  it("crosses months and years", () => {
    expect(msUntilNext(7, local(2026, 9, 31, 8))).toBe(23 * HOUR); // Oct 31 → Nov 1
    expect(msUntilNext(7, local(2026, 11, 31, 8))).toBe(23 * HOUR); // Dec 31 → Jan 1
  });

  it("knows a day can be 25 hours: summer time ends on Sunday 2026-10-25", () => {
    // Saturday 08:00 → Sunday 07:00 is 23 hours on the clock, but the clock goes back an hour
    expect(msUntilNext(7, local(2026, 9, 24, 8))).toBe(24 * HOUR);
  });

  it("knows a day can be 23 hours: summer time starts on Sunday 2027-03-28", () => {
    // Saturday 08:00 → Sunday 07:00 is 23 hours on the clock, but the clock skips an hour
    expect(msUntilNext(7, local(2027, 2, 27, 8))).toBe(22 * HOUR);
  });

  it("does not change the Date it was given", () => {
    const now = local(2026, 9, 21, 8, 15);
    const before = now.getTime();
    msUntilNext(7, now);
    expect(now.getTime()).toBe(before);
  });
});

// Given code (startScheduler), but it uses your msUntilNext. Fake timers: no real waiting.
describe("startScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs at the hour, then again every day at that hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 9, 21, 6, 0));
    const run = vi.fn(async () => {});
    const scheduler = startScheduler({ hour: 7, run });

    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(run).toHaveBeenCalledTimes(0); // 06:59:59.999
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1); // 07:00 Wednesday
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(run).toHaveBeenCalledTimes(2); // 07:00 Thursday
    scheduler.stop();
  });

  it("keeps going after run() throws, and reports the error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 9, 21, 6, 0));
    const run = vi.fn(async () => {
      throw new Error("database is locked");
    });
    const errors: unknown[] = [];
    const scheduler = startScheduler({ hour: 7, run, onError: (err) => errors.push(err) });

    await vi.advanceTimersByTimeAsync(25 * HOUR);
    expect(run).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([new Error("database is locked"), new Error("database is locked")]);
    scheduler.stop();
  });

  it("stops: no more runs after stop()", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(2026, 9, 21, 6, 0));
    const run = vi.fn(async () => {});
    startScheduler({ hour: 7, run }).stop();
    await vi.advanceTimersByTimeAsync(48 * HOUR);
    expect(run).not.toHaveBeenCalled();
  });
});
