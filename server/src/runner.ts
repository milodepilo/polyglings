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
  // code is null when the process was killed by a signal (crash, or own kill)
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
  return new Promise((resolve, reject) => {
    const data: Buffer[] = [];
    let timedOut = false;
    let count = 0;
    let truncated = false;
    const pushChunk = (chunk: Buffer) => {
      if (truncated) return;
      const chunkSize = chunk.length;
      if (count + chunkSize <= opts.maxOutputBytes) {
        data.push(chunk);
        count += chunkSize;
      } else {
        const room = opts.maxOutputBytes - count;
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

interface Step {
  kind: "compile" | "run"; // a failing compile step → compile_error, a failing run step → fail
  cmd: string;
  args: string[];
}

interface Toolchain {
  files: (code: string, tests: string) => Record<string, string>; // filename → content
  steps: Step[];
}

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
  const settings = { ...CHECK_DEFAULTS, ...opts };
  const files = Object.entries(TOOLCHAINS[lang].files(code, tests));
  const steps = TOOLCHAINS[lang].steps;
  const dir = await mkdtemp(
    join(settings.tmpRoot ?? tmpdir(), `${lang}-exercise-`),
  );
  try {
    for (const [filename, content] of files) {
      await writeFile(join(dir, filename), content);
    }
    for (const step of steps) {
      const result = await runProcess(step.cmd, step.args, {
        cwd: dir,
        timeoutMs:
          step.kind === "compile"
            ? settings.compileTimeoutMs
            : settings.timeoutMs,
        maxOutputBytes: settings.maxOutputBytes,
      });
      if (result.kind === "timeout") {
        return { status: "timeout" };
      } else if (result.code !== 0) {
        return {
          status: step.kind === "compile" ? "compile_error" : "fail",
          output: result.output,
        };
      }
    }
    return { status: "pass" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
