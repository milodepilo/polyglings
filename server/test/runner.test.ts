import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { check, runProcess, TRUNCATED, type ProcessOptions } from "../src/runner.js";
import type { CheckResult } from "../src/types.js";

// Run a snippet of JavaScript in a fresh node process: portable, no files needed.
const node = (script: string, opts: Partial<ProcessOptions> = {}) =>
  runProcess(process.execPath, ["-e", script], { timeoutMs: 5_000, maxOutputBytes: 100_000, ...opts });

describe("runProcess", () => {
  it("collects stdout and the exit code", async () => {
    expect(await node(`console.log("hi")`)).toEqual({ kind: "exit", code: 0, signal: null, output: "hi\n" });
  });

  it("reports a non-zero exit code and includes stderr in the output", async () => {
    const result = await node(`console.log("out"); console.error("boom"); process.exit(3)`);
    expect(result).toMatchObject({ kind: "exit", code: 3 });
    expect(result.kind === "exit" && result.output).toContain("out");
    expect(result.kind === "exit" && result.output).toContain("boom");
  });

  it("runs in the given working directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "polyglings-cwd-"));
    try {
      const result = await node(`console.log(process.cwd())`, { cwd: dir });
      expect(result.kind === "exit" && result.output.trim()).toBe(await realpath(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("collects all output of a large write", async () => {
    const result = await node(`process.stdout.write("y".repeat(300_000))`, { maxOutputBytes: 1_000_000 });
    expect(result.kind === "exit" && result.output.length).toBe(300_000);
  });

  it("kills a process that runs too long", async () => {
    const start = Date.now();
    expect(await node(`setInterval(() => {}, 1000)`, { timeoutMs: 300 })).toEqual({ kind: "timeout" });
    expect(Date.now() - start).toBeLessThan(3_000);
  });

  it("does not hang on a program that reads stdin", async () => {
    const result = await node(`process.stdin.resume(); process.stdin.on("end", () => console.log("eof"))`, {
      timeoutMs: 2_000,
    });
    expect(result).toEqual({ kind: "exit", code: 0, signal: null, output: "eof\n" });
  });

  it("cuts off endless output and stops the process early", async () => {
    const start = Date.now();
    const result = await node(`for (;;) process.stdout.write("x".repeat(1000))`, {
      timeoutMs: 10_000,
      maxOutputBytes: 10_000,
    });
    expect(Date.now() - start).toBeLessThan(5_000); // did not wait for the timeout
    expect(result.kind).toBe("exit");
    if (result.kind !== "exit") return;
    expect(result.output.endsWith(TRUNCATED)).toBe(true);
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(10_000 + TRUNCATED.length);
  });

  it("reports the signal when the process is killed (e.g. a crash)", async () => {
    expect(await node(`process.kill(process.pid, "SIGKILL")`)).toMatchObject({
      kind: "exit",
      code: null,
      signal: "SIGKILL",
    });
  });

  it("rejects when the command does not exist", async () => {
    await expect(
      runProcess("polyglings-no-such-command", [], { timeoutMs: 1_000, maxOutputBytes: 1_000 }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------

const outputOf = (r: CheckResult) => ("output" in r ? r.output : "");

const JS_TESTS = `
import assert from "node:assert/strict";
import { add } from "./main.js";
assert.equal(add(2, 3), 5);
`;
const TS_TESTS = `
import assert from "node:assert/strict";
import { first } from "./main.js";
assert.equal(first([1, 2]), 1);
assert.equal(first<string>([]), undefined);
`;
const CPP_TESTS = `
#include <cassert>
#include "main.cpp"
int main() { assert(add(2, 3) == 5); }
`;

describe("check", { timeout: 30_000 }, () => {
  let tmpRoot: string;
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "polyglings-root-"));
  });
  afterEach(async () => {
    // every check must clean up its temp dir, also after a failure or a timeout
    expect(await readdir(tmpRoot)).toEqual([]);
    await rm(tmpRoot, { recursive: true, force: true });
  });

  describe("js", () => {
    it("passes correct code", async () => {
      const r = await check("js", "export function add(a, b) { return a + b; }", JS_TESTS, { tmpRoot });
      expect(r).toEqual({ status: "pass" });
    });
    it("fails wrong code, with the assertion in the output", async () => {
      const r = await check("js", "export function add(a, b) { return a - b; }", JS_TESTS, { tmpRoot });
      expect(r.status).toBe("fail");
      expect(outputOf(r)).toContain("AssertionError");
    });
    it("times out on an endless loop", async () => {
      const r = await check("js", "export function add() { for (;;) {} }", JS_TESTS, { tmpRoot, timeoutMs: 1_000 });
      expect(r).toEqual({ status: "timeout" });
    });
  });

  describe("ts", () => {
    it("passes correct code", async () => {
      const code = "export function first<T>(xs: T[]): T | undefined { return xs[0]; }";
      expect(await check("ts", code, TS_TESTS, { tmpRoot })).toEqual({ status: "pass" });
    });
    it("fails wrong code", async () => {
      const code = "export function first<T>(xs: T[]): T | undefined { return xs[1]; }";
      expect((await check("ts", code, TS_TESTS, { tmpRoot })).status).toBe("fail");
    });
  });

  describe("cpp", () => {
    it("passes correct code", async () => {
      const r = await check("cpp", "int add(int a, int b) { return a + b; }", CPP_TESTS, { tmpRoot });
      expect(r).toEqual({ status: "pass" });
    });
    it("fails wrong code, with the failed assert in the output", async () => {
      const r = await check("cpp", "int add(int a, int b) { return a - b; }", CPP_TESTS, { tmpRoot });
      expect(r.status).toBe("fail");
      expect(outputOf(r)).toContain("Assertion");
    });
    it("reports a compile error with the compiler output", async () => {
      const r = await check("cpp", "int add(int a, int b) { return a + ; }", CPP_TESTS, { tmpRoot });
      expect(r.status).toBe("compile_error");
      expect(outputOf(r)).toContain("error");
    });
    it("times out on an endless loop", async () => {
      const code = "int add(int a, int b) { volatile int n = 0; while (true) { n = n + 1; } }";
      expect(await check("cpp", code, CPP_TESTS, { tmpRoot, timeoutMs: 1_000 })).toEqual({ status: "timeout" });
    });
  });

  it("runs two checks at the same time without them getting in each other's way", async () => {
    const [good, bad] = await Promise.all([
      check("js", "export function add(a, b) { return a + b; }", JS_TESTS, { tmpRoot }),
      check("js", "export function add(a, b) { return 0; }", JS_TESTS, { tmpRoot }),
    ]);
    expect(good).toEqual({ status: "pass" });
    expect(bad.status).toBe("fail");
  });
});
