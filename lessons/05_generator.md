# 05 – The generator: an LLM you don't trust either

The runner protects you from code that misbehaves. The generator protects you from **exercises** that misbehave: Claude writes a description, starter, tests and solution, and sometimes the tests don't match the solution, or the starter already passes, or the JSON is missing a field. In this milestone you write the loop that only lets through exercises that **provably work**.

## What's already there
| file | what |
|---|---|
| `src/generator.ts` | part 1 schema + prompt (given), part 2 `claudeCli` (given), part 3 `generateExercise` (yours) |
| `test/generator.test.ts` | 17 tests for `generateExercise`, 3 for `claudeCli` (with a fake `claude`) |

Small change from milestone 4: `type Checker` moved from `app.ts` to `runner.ts`. The generator needs it too, and `generator.ts` importing from `app.ts` would point the wrong way: HTTP depends on the logic, not the other way around.

## Part 1: one schema, two jobs
```ts
export const ExerciseDraftSchema = ExerciseSchema.pick({ topic: true, description: true, ... });
export const DRAFT_JSON_SCHEMA = z.toJSONSchema(ExerciseDraftSchema, { target: "draft-7" });
```
- `.pick` makes a smaller schema from `ExerciseSchema`, so the LLM only writes the fields that are its job. `id`, `lang`, `difficulty`, `createdAt` and `prompt` come from **you**: you already know those, and an LLM making up ids is asking for trouble.
- `z.toJSONSchema` converts the zod schema into a standard **JSON Schema**, which `claude --json-schema` understands. Claude then has to answer in exactly that shape (structured output).
- That's **one source of truth**: if you add a field to `ExerciseSchema`, both the prompt contract and the validation update automatically.

**But:** even with `--json-schema` you still validate the result with zod yourself. The JSON Schema is a *request* to Claude, and your `safeParse` is the *check*. Same principle as milestone 2: everything from outside is `unknown` until zod says otherwise. That's why `Llm` returns `Promise<unknown>`.

(`target: "draft-7"`: JSON Schema has versions. zod writes the newest one by default, `2020-12`, and claude's validator rejects it with `no schema with key or ref`. You'd only find that by trying it for real, which is also why the `claudeCli` tests don't catch it.)

## Part 2: talking to the CLI
`claudeCli` uses `execFile`, not `spawn`. In lesson 04 you read why `spawn` fits the runner: unknown code, possibly endless output, so count while it streams. Here it's the other way around: `claude` is a **trusted** program, its output is one JSON object, and you can only use it once it's complete anyway. `execFile` buffers everything and gives you `stdout` in one callback. That's simpler, and `maxBuffer` + `timeout` are enough protection.

Three details, each one learned the hard way:
- **`child.stdin?.end()`**: `claude -p` also reads stdin (so you can pipe things in). With `execFile`, stdin is an open pipe, so without `end()` claude waits forever. Same lesson as `stdio: "ignore"` in the runner, different solution.
- **`--tools ""`**: Claude only needs to *write*. Without this flag it could run tools (Bash, reading files) during generation. On the Pi, that's a process with your token that runs commands.
- **The error message**: `execFile`'s `err.message` repeats the entire command, prompt included. The actual reason is on `stderr`, so `claudeCli` puts only that in the error.

And the **token**: `claudeCli` doesn't contain one. The `claude` process inherits the environment: on the Pi that's `CLAUDE_CODE_OAUTH_TOKEN` from `/etc/polyglings/env` (milestone 9), and on WSL it's your login. Secrets belong in the environment, not in code.

## Part 3: generate → validate → retry
Every draft goes through three gates:

| gate | must be | why |
|---|---|---|
| zod `safeParse` | success | a missing field crashes the CLI later |
| `checker(solution)` | `pass` | otherwise the exercise is unsolvable |
| `checker(starter)` | `fail` or `compile_error` | otherwise it's "done" before you start. `timeout` doesn't count: a starter that hangs gives you 5 seconds of waiting per save |

It fails at a gate? Then you try again, but **not blindly**. If you just ask the same question again, you have a good chance of getting the same mistake. Tell the next attempt *what* was wrong. That's what the `feedback` parameter of `buildPrompt` is for.

The pattern, in another context:
```ts
// example: ask a password service until the password meets the policy (not your generator!)
async function getPassword(service: PasswordService, maxTries = 3): Promise<string> {
  const problems: string[] = [];
  for (let i = 0; i < maxTries; i++) {
    const pw = await service.suggest(problems.at(-1));   // previous problem as a hint
    if (pw.length < 12) { problems.push(`"${pw}" is too short`); continue; }
    if (!/\d/.test(pw)) { problems.push(`"${pw}" has no digit`); continue; }
    return pw;                                             // through all gates
  }
  throw new Error(`gave up:\n${problems.join("\n")}`);
}
```
- `continue` jumps to the next attempt. `return` in the middle of the loop is the way out on success.
- One reason per failed attempt. That list goes into the error, so you can see in the log *why* it failed.

### Which errors do you retry?
Not every error is a bad draft. If `claude` itself fails (not logged in, no network, rate limit), a new attempt won't help: you'd only burn the next attempt. So the rule is: **retry on a bad draft, pass through an error from the LLM itself.** Concretely: you don't need a `try/catch` around `deps.llm(...)`. If it rejects, it propagates on its own.

### The result
A successful draft becomes a full `Exercise`:
- `id`: `newExerciseId(lang)` (given, `ts-3f9a1c2e`)
- `createdAt`: now, as an ISO string (like your seed in `main.ts`)
- `prompt`: the requested topic, **only** if there is one. With `exactOptionalPropertyTypes`, `prompt: undefined` isn't allowed. You've solved this before in `sqlite-store.ts`.

### Custom errors
`GenerationError extends Error` (given) carries a `reasons` array. The route in 5b can do `err instanceof GenerationError` and answer with something other than a 500: "Claude couldn't make a working exercise" is a different message from "the server is broken".

## Exercise 5
Fill in `generateExercise` in `src/generator.ts` (see `TODO(human)`):
```bash
npx vitest run test/generator.test.ts
```
Without a real `claude`, the tests take a second. One test runs the real `check` on a JS draft.

Then for real (costs a bit of your Pro usage, about 15–30 s per exercise):
```bash
npx tsx -e '
import { claudeCli, generateExercise } from "./src/generator.ts";
import { check } from "./src/runner.ts";
generateExercise({ lang: "ts", difficulty: 3, topic: "generics" }, { llm: claudeCli(), checker: check })
  .then((ex) => console.log(ex), (err) => console.error(err));'
```
(`.then` instead of `await`: `tsx -e` doesn't allow top-level `await`.)

## Food for thought
- **Cost**: each attempt is a call to Claude. Why is `maxAttempts` 2 and not 10? What does a request cost in seconds on the Pi if both attempts fail?
- **Repetition**: if you ask for "generics" ten times, you'll probably get `first<T>` five times. How would you send the topics of the last exercises along in the prompt?
- **Weak tests**: a test file without any `assert` would pass for the starter too, so gate 3 catches it. But what about tests that only check *one* easy case (`double(0) === 0`)? The starter `return 0` fails... or not? Which kind of weak test still gets through all three gates?

## Part 4: wiring it into the API
`POST /exercises/generate` still answers `501`. Now: generate → store → `201` with the exercise.

### buildApp gets a deps object
`buildApp` had `(store, opts, checker)`, and a generator would make it four positional parameters. A test that only wants to fake the generator would then have to write `buildApp(store, {}, undefined, fakeGenerate)`. That's why there's now one object:
```ts
buildApp({ store });                                         // main.ts: the rest is the real thing
buildApp({ store, checker: fakeCheck, generate: fakeGen });  // tests
```
Named fields are order-independent and self-explanatory, and you leave out what you don't need. `main.ts` and the tests have already been updated (`buildApp({ store }, { logger: true })`).

The defaults are in the destructure at the top of `buildApp`. Note that the default `generate` uses the **same** `checker`: a fake checker in a test therefore applies to generation too. A default can use another dep because it's a closure over the variables destructured before it.

### Status codes
| case | code | why |
|---|---|---|
| success | **201 Created** | a new resource has been created, not just "OK" |
| `GenerationError` | **502 Bad Gateway** | the server itself is fine, but the "upstream" (Claude) didn't deliver something usable |
| anything else (claude not logged in, g++ missing) | **500** | really broken: someone has to fix the server |

`201` with a body: `reply.code(201).send(exercise)`. Without `.code`, Fastify would give `200`.

### A try/catch, this time on purpose
In the submit route (lesson 04) you deliberately **didn't** have a try/catch: every error was a 500, and Fastify does that for you. Here, one specific error has to become something else. The pattern:
```ts
// example: a payment route (not your code!)
try {
  const receipt = await charge(card, amount);
  return reply.code(201).send(receipt);
} catch (err) {
  if (err instanceof CardDeclinedError) {
    return reply.code(402).send({ error: "card declined", reason: err.reason });
  }
  throw err;   // everything else: not ours to handle → Fastify → 500
}
```
- `err` in a `catch` is `unknown` in TS (anything can be thrown, even a string). `instanceof` narrows it to your class, so after that `err.reason` is allowed.
- **`throw err`**: re-throwing what you don't recognise is essential. A `catch` that swallows everything turns a "not logged in" into a misleading 502.
- Keep the `try` **small**: only the code whose errors you're translating.

### Difficulty: always 1 for now
`GenerateRequestSchema` only has `lang` and `topic`. Where the difficulty comes from is milestone 6 (progress: your level per language). Until then, the route passes `difficulty: 1`. `generateExercise` needs a `GenerationRequest`, and you have the validated body plus that one number.

### Exercise 5b
In `src/app.ts`, see `TODO(human)` in the generate route:
```bash
npx vitest run test/app.test.ts -t "generate"
```
Then for real (costs a Claude call, takes 10–30 s):
```bash
npm run dev
# another pane:
curl -s -X POST localhost:3000/exercises/generate \
  -H 'content-type: application/json' -d '{"lang":"cpp","topic":"references"}' | jq
```
Then `curl -s localhost:3000/exercises | jq '.[].topic'`. It's in SQLite, so it survives a restart too.

### Food for thought
- The request takes 10–30 seconds. What happens if you click "generate" twice on your phone (milestone 10)? Two Claude calls in parallel on a Pi with 4 cores, each followed by `g++`. How would you allow only one at a time?
- Who chooses the language and topic in milestone 7 (the scheduler)? It can call `generate` directly, without HTTP. Why is that easy now?
