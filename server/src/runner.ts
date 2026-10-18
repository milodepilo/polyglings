// Runs exercise code in a throwaway directory and turns the outcome into a CheckResult.
// Lesson: ../lessons/04_runner.md
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CheckResult, Language } from "./types.js";

// ---------------------------------------------------------------------------
// Part 1: run ONE process and collect what it prints
// ---------------------------------------------------------------------------

export interface ProcessOptions {
  cwd?: string;
  timeoutMs: number; // kill the process after this long
  maxOutputBytes: number; // kill the process once it has printed this much
}

export type ProcessResult =
  // code is null when the process was killed by a signal (crash, or our own kill)
  | {
      kind: "exit";
      code: number | null;
      signal: NodeJS.Signals | null;
      output: string;
    }
  | { kind: "timeout" };

// appended to the output when it was cut off at maxOutputBytes
export const TRUNCATED = "\n[output truncated]";

export function runProcess(
  cmd: string,
  args: string[],
  opts: ProcessOptions,
): Promise<ProcessResult> {
  // TODO(human): implement runProcess (part 1) and check (part 3); spec: test/runner.test.ts
  //
  //   runProcess: spawn cmd, collect stdout + stderr into one output, and resolve once it's done.
  //     - stdin must not be left open (a program that reads stdin would wait forever)
  //     - kill it after opts.timeoutMs        → { kind: "timeout" }
  //     - kill it after opts.maxOutputBytes   → output cut off + TRUNCATED
  //     - a command that doesn't exist        → reject
  //   check: see part 3 below. Part 2 (TOOLCHAINS) is given.
  return new Promise((resolve, reject) => {
    const data: Buffer[] = [];
    let timedOut = false;
    let count = 0;
    let truncated = false;
    const pushChunk = (chunk: Buffer) => {
      if (truncated) return;
      const chunkSize = chunk.length;
      const room = opts.maxOutputBytes - count;
      if (count + chunkSize <= opts.maxOutputBytes) {
        data.push(chunk);
        count += chunkSize;
      } else {
        truncated = true;
        data.push(chunk.subarray(0, room));
        child.kill("SIGKILL");
      }
    };
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.stdout.on("data", pushChunk);
    child.stderr.on("data", pushChunk);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      const result: ProcessResult = timedOut
        ? { kind: "timeout" }
        : {
            kind: "exit",
            code,
            signal,
            output:
              Buffer.concat(data).toString("utf8") +
              (truncated ? TRUNCATED : ""),
          };
      clearTimeout(timer);
      resolve(result);
    });
  });
}

// ---------------------------------------------------------------------------
// Part 2: per language, which files to write and which commands to run (given)
// ---------------------------------------------------------------------------

interface Step {
  kind: "compile" | "run"; // a failing compile step → compile_error, a failing run step → fail
  cmd: string;
  args: string[];
}

interface Toolchain {
  files: (code: string, tests: string) => Record<string, string>; // filename → content
  steps: Step[];
}

// tsx's command-line script, resolved from this project's node_modules, so the
// runner works from any temp dir without npx
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

export const TOOLCHAINS: Record<Language, Toolchain> = {
  // tests do: import { add } from "./main.js"
  js: {
    files: (code, tests) => ({
      "package.json": '{ "type": "module" }',
      "main.js": code,
      "main.test.js": tests,
    }),
    steps: [{ kind: "run", cmd: process.execPath, args: ["main.test.js"] }],
  },
  // tests do: import { first } from "./main.js"  (tsx maps .js → .ts, like your server code)
  ts: {
    files: (code, tests) => ({
      "package.json": '{ "type": "module" }',
      "main.ts": code,
      "main.test.ts": tests,
    }),
    steps: [
      { kind: "run", cmd: process.execPath, args: [TSX_CLI, "main.test.ts"] },
    ],
  },
  // tests do: #include "main.cpp" and define main() with assert()s
  cpp: {
    files: (code, tests) => ({ "main.cpp": code, "test.cpp": tests }),
    steps: [
      {
        kind: "compile",
        cmd: "g++",
        args: ["-std=c++20", "-Wall", "-o", "test", "test.cpp"],
      },
      { kind: "run", cmd: "./test", args: [] },
    ],
  },
};

// ---------------------------------------------------------------------------
// Part 3: check an exercise: temp dir → write files → run the steps → clean up
// ---------------------------------------------------------------------------

export interface CheckOptions {
  timeoutMs?: number; // per run step
  compileTimeoutMs?: number; // per compile step (g++ on the Pi can take a few seconds)
  maxOutputBytes?: number;
  tmpRoot?: string; // where the temp dir is created (default: the OS temp dir)
}

export const CHECK_DEFAULTS = {
  timeoutMs: 5_000,
  compileTimeoutMs: 30_000,
  maxOutputBytes: 64 * 1024,
};

export async function check(
  lang: Language,
  code: string,
  tests: string,
  opts: CheckOptions = {},
): Promise<CheckResult> {
  // part of the TODO above: make a temp dir, write TOOLCHAINS[lang].files, run its steps
  // in order, map the first failure to a CheckResult, and ALWAYS remove the temp dir
  throw new Error("not implemented");
}
