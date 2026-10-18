# 04 – The runner: running code you don't trust

`POST /exercises/:id/submit` still answers `501`. To check a submission, the server has to **run** it: write it to disk, call `node`, `tsx` or `g++`, and read what comes out. In this milestone you write that runner.

## What's already there
| file | what |
|---|---|
| `src/runner.ts` | part 1 `runProcess` (yours), part 2 `TOOLCHAINS` (given), part 3 `check` (yours) |
| `test/runner.test.ts` | 9 tests for `runProcess`, 10 for `check` |

`TOOLCHAINS` is given: per language, which files to write and which commands to run. Read it first. That's the contract between the runner and the exercises the generator will produce in milestone 5:

| lang | files | steps |
|---|---|---|
| js | `main.js`, `main.test.js` | `node main.test.js` |
| ts | `main.ts`, `main.test.ts` | `tsx main.test.ts` (no type check, see food for thought) |
| cpp | `main.cpp`, `test.cpp` (which `#include "main.cpp"`) | `g++ ... -o test test.cpp`, then `./test` |

Every test file signals the result the Unix way: **exit code 0 = pass**, anything else = fail. `assert` (Node) and `assert()` (C++) make the process exit non-zero on failure.

## What can go wrong when you run code
The code comes from Claude (the solution and starter) and from you (your submission). Nobody's malicious, but mistakes are guaranteed:

| mistake | without protection | your protection |
|---|---|---|
| `while (true) {}` | the request hangs forever | **timeout**: kill after N ms |
| `for (;;) console.log("x")` | gigabytes of output in RAM | **output cap**: kill after N bytes |
| `std::cin >> x` | waits for input that never comes | **stdin closed** |
| a segfault | no output, no exit code | report the **signal** |
| `g++` missing | a cryptic crash | **reject** with a clear error |

Real isolation (a separate low-privilege user, memory limits, no network) comes in milestone 9 via systemd. The runner handles what a single process can handle.

## child_process: spawn, exec, execFile
Node has three ways to start a program:
- `exec("ls -la")`: runs a **shell** command and buffers all output. Simple, but the shell interprets the string, which risks injection like in milestone 3, and the buffer has no streaming.
- `execFile("ls", ["-la"])`: no shell, but still buffered.
- **`spawn("ls", ["-la"])`**: no shell, and output arrives as a **stream** of chunks. You need that streaming for the output cap: you count while it comes in, instead of after everything is already in memory.

```ts
import { spawn } from "node:child_process";

const child = spawn("ping", ["-c", "3", "example.com"], {
  cwd: "/tmp",                          // working directory of the child
  stdio: ["ignore", "pipe", "pipe"],    // stdin, stdout, stderr
});

child.stdout.on("data", (chunk: Buffer) => { /* a piece of output */ });
child.stderr.on("data", (chunk: Buffer) => { /* a piece of error output */ });
child.on("error", (err) => { /* could not start at all, e.g. ENOENT */ });
child.on("close", (code, signal) => { /* done, and all output has been read */ });
child.kill("SIGKILL");                  // stop it now
```

### stdio
`stdio` says what to connect to the child's stdin, stdout and stderr. `"pipe"` gives you a stream in Node. `"ignore"` connects it to `/dev/null`. The default is `"pipe"` for all three, which means stdin stays **open** and a program that reads input waits forever. `"ignore"` for stdin gives it an immediate end-of-file.

### `exit` vs `close`
- `exit`: the process has stopped. Its output may still be **in transit** in the pipe.
- `close`: the process has stopped **and** stdout/stderr are fully read.

You want `close`. With `exit` you'll occasionally miss the last piece of output, a bug that shows up once in a hundred runs (the test can't catch it reliably, so this one's on you).

### code and signal
`close` gives you `(code, signal)`. A normal exit is `(0, null)` or `(1, null)`. A process killed by a signal, whether a segfault, an abort from `assert()` or your own `kill`, gives `(null, "SIGSEGV")`. That's why `ProcessResult` has `code: number | null`.

### SIGTERM vs SIGKILL
`child.kill()` sends `SIGTERM` by default: a polite request that a program may ignore. `SIGKILL` can't be ignored or caught. For runaway code you want `SIGKILL`.

## Events → a Promise
`spawn` speaks in events, but you want to `await` the result. The bridge is `new Promise`: you call `resolve` or `reject` from inside the event handlers.

```ts
// example: wait for a file download to finish (not your runner!)
function download(url: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = startDownload(url, path);
    let bytes = 0;
    req.on("data", (chunk: Buffer) => { bytes += chunk.length; });
    req.on("error", reject);                  // failure → the await throws
    req.on("end", () => resolve(bytes));      // success → the await returns bytes
  });
}
```
Only the **first** `resolve` or `reject` counts. Later calls are ignored, which is convenient when, for example, both `error` and `close` fire.

## Timeout
Node has no "run with timeout" for you, so you build it yourself:
```ts
const timer = setTimeout(() => {
  /* remember that it was a timeout, then kill */
}, ms);
// ...and when the process is done:
clearTimeout(timer);
```
Watch out: after your kill, `close` still fires (with `signal: "SIGKILL"`). In the `close` handler you have to know *why* it stopped, so keep a variable for that. And `clearTimeout` matters: otherwise the timer stays pending for up to `timeoutMs` after a fast process.

(`spawn` also has a `timeout` option. It works, but then you have to deduce from the signal whether it was a timeout. Your own timer is more explicit.)

## Output: Buffers, not strings
`data` gives you a **`Buffer`**: raw bytes, not text. Two things to know:
- `chunk.length` counts **bytes**. `"é".length` is 1, but it's 2 bytes in UTF-8. Your limit is in bytes.
- **Collect the Buffers and convert to text once at the end:**
  ```ts
  const chunks: Buffer[] = [];
  // in "data": chunks.push(chunk)
  const text = Buffer.concat(chunks).toString("utf8");
  ```
  If you convert each chunk to a string separately, a multi-byte character split across two chunks turns into `��`.
- Part of a Buffer: `chunk.subarray(0, n)`, the first `n` bytes.

stdout and stderr go into the **same** `chunks`, in the order they arrive. That's how you'd see them in a terminal too.

## Part 3: check
```
mkdtemp → write the files → run the steps in order → map the result → rm (always)
```
- `mkdtemp(join(tmpdir(), "prefix-"))` creates a new, unique directory, like `/tmp/prefix-a8Xk2q`. Two simultaneous checks never get the same one (there's a test for that).
- `writeFile(join(dir, name), content)` for each file. `Object.entries(obj)` gives you `[key, value]` pairs to loop over.
- Steps run **in order**, and the first failure stops it. A failing `compile` step is `compile_error`, and a failing `run` step is `fail`. A timeout in any step is `timeout`.
- **Cleanup in `finally`:** `rm(dir, { recursive: true, force: true })`. `finally` runs after a `return`, after a `throw` and after a timeout. The tests check that `tmpRoot` is empty after *every* check.

### Options with defaults
`CheckOptions` is all optional, and `CHECK_DEFAULTS` has the values. Merging is one spread:
```ts
const settings = { ...DEFAULTS, ...userOptions };   // later keys win
```
With `exactOptionalPropertyTypes`, an options object can't contain `cwd: undefined`. A key is there or it isn't. You've seen that before with `prompt`.

## Exercise 4
Fill in `src/runner.ts` (see `TODO(human)`). Run only these tests with:
```bash
npx vitest run test/runner.test.ts
npx vitest run test/runner.test.ts -t "runProcess"   # only the runProcess tests
```
Suggested order:
1. `runProcess`: spawn, collect output, resolve on `close` → the first tests
2. `stdio` → the stdin test
3. `error` → the "does not exist" test
4. timeout
5. output cap
6. `check`: temp dir, files, steps, `finally`

The `check` tests run real `node`, `tsx` and `g++`, so they take a few seconds.

## Food for thought
- **Grandchildren:** `child.kill()` only kills the direct child. If test code itself starts a process, that one keeps running. Look up `detached: true` and `process.kill(-child.pid)` (a minus sign = the whole process group).
- **TypeScript without types:** `tsx` strips types without checking them. A TS exercise "add the right types" passes even with wrong types. How would you add a `tsc --noEmit` step as `compile`, and what would that cost on the Pi?
- **A crash without output:** a segfault gives `fail` with an empty `output`. How would you tell the user what happened? (`signal` is in your `ProcessResult`.)
