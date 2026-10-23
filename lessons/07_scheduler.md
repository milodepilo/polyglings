# 07 – Scheduler: new exercises every morning

So far you only get an exercise when you ask for one (`POST /exercises/generate`). In this milestone, the server takes care of it itself: every morning, every language where you've solved everything gets one new exercise, at your level for that language. Still working on a ts exercise? Then ts waits, but cpp and js don't.

Two parts:
- **7a**: `runDaily` in `src/scheduler.ts`: the job itself. One call = "check, and generate if needed". No timers, so easy to test.
- **7b** (next): run that job every morning at a fixed time, and wire it into `main.ts`.

Why split it? The decision ("should I generate, and what?") and the timing ("when?") are two different problems. A function you can just call is testable in milliseconds; a timer that only goes off at 07:00 isn't.

## What's given
| file | what |
|---|---|
| `src/sql.ts` | `LIST_OPEN`: every exercise with no `pass` yet |
| `src/store.ts` | `ExerciseStore.listOpen()`, implemented in `MemoryStore` |
| `src/sqlite-store.ts` | `listOpen()` (uses your `rowToExercise`) |
| `src/scheduler.ts` | the types `DailyDeps`, `GenerationFailure`, `SkippedLanguage`, `DailyResult` |
| `test/scheduler.test.ts` | 7 tests: the spec |

"Open" means: no `pass` yet. An exercise you tried 20 times and failed is still open. `listOpen()` gives you the open exercises of **all** languages; which ones belong to the language you're looking at is up to you.

## A background job is not a request
In the generate **route**, an unexpected error gets rethrown (`throw err`), and Fastify turns it into a 500. That's right there: someone is waiting for an answer, and they get to see it went wrong.

At 07:00, nobody is waiting. If the job throws, there's no one to see a 500; the error just disappears into a log (or worse, crashes the process). So a background job works differently:
- **It catches per item, not around everything.** If `ts` fails, `cpp` and `js` should still get made.
- **It reports what happened**, instead of throwing: what was added, what failed and why. 7b logs that.

```ts
// example: sending a newsletter (not your code!)
for (const subscriber of subscribers) {
  try {
    await sendMail(subscriber);
    sent.push(subscriber.email);
  } catch (err) {
    bounced.push({ email: subscriber.email, reason: /* ... */ });
  }
}
// one bad address doesn't stop the other 999
```
Compare where the `try` sits with a `try` around the whole `for`. What happens to subscriber 3 when subscriber 2 fails?

## `catch (err)`: what is `err`?
In TS, `err` in a `catch` is **`unknown`**. Not `Error`, because JavaScript lets you throw anything:
```ts
throw new Error("disk full");  // the normal case
throw "disk full";             // allowed, and some libraries do it
throw { code: 42 };            // also allowed
```
`unknown` means: "you have to check before you use it". `err.message` is a TS error until you've proven that `err` is an `Error`:
```ts
// example
function describe(x: unknown): string {
  if (x instanceof Date) return x.toISOString();   // here x is a Date
  return String(x);                                // anything else → text
}
```
`instanceof` is a **narrowing** check, like `status === "fail"` on your `CheckResult`. The test "also survives errors that aren't GenerationErrors" throws both an `Error` and a plain string. Look at what `reason` must be for each one: `String(new Error("x"))` gives `"Error: x"`, not `"x"`.

## One at a time, not all at once
Each generation starts `claude`, then `g++` or `tsx` twice for validation. On a Pi 4, three of those at the same time is asking for trouble: memory, CPU, and one Claude login that may get rate limited. So: **one at a time**.

```ts
// example: three downloads
for (const url of urls) {
  await download(url);           // ✓ waits: one at a time, in order
}

await Promise.all(urls.map((url) => download(url)));   // all at once (fine elsewhere, not here)

urls.forEach(async (url) => {
  await download(url);           // ✗ forEach does NOT wait for async callbacks:
});                              //   all three start, and the line after this runs right away
```
That last one is a classic bug: it looks sequential, but `forEach` ignores the promise your callback returns. The test "generates one at a time" catches the first two; the last one fails other tests too (try to find out which, and why).

## Safe to run twice
What if the job runs twice: a restart at 07:00, or you trigger it manually after the timer already went? The first run adds one exercise per language, and those are open, so the second run **skips** every language. The job checks the state before acting, so running it again does no harm. That's called **idempotent**.

```ts
// example: a dishwasher that only starts when it's full
if (dishwasher.isRunning()) return "already running";
```
You get this for free from the rule "only generate for a language with nothing open", as long as you **store** each exercise as soon as it's made.

And the same rule fixes failures by itself: if ts failed yesterday, ts has nothing open today, so it gets tried again. cpp and js still have their open exercises from yesterday, so they wait. The last test checks exactly that.

## The result: three lists
`DailyResult` has `added`, `failed` and `skipped`, and every language ends up in **exactly one** of them. That makes the log in 7b easy ("cpp: added, ts: skipped (2 open), js: failed: ..."), and you can check it at a glance: three languages in, three entries out.

You can build the result up as you go: start with three empty lists and `push` into the right one per language. A `const` object with arrays inside can still be filled. `const` means you can't point the name at a different object, not that the object can't change:
```ts
// example
const basket = { fruit: [] as string[], veg: [] as string[] };
basket.fruit.push("apple");   // ✓ changing what's inside
basket = { fruit: [], veg: [] };   // ✗ TS error: reassigning a const
```
If you type it as `const result: DailyResult = { ... }`, TS also knows what the empty arrays may contain, so no `as` is needed.

## Things you'll need
- `store.listOpen()`: what's still open (all languages); `.filter(...)` gives you the ones for one language
- `computeProgress(store.listSolved())`: your level per language (you did this in 6b)
- `LANGUAGES` from `types.ts`: loop over it, so the order is `cpp`, `ts`, `js`
- `deps.generate({ lang, difficulty })`: **without** a `topic` key; the LLM picks one. (With `exactOptionalPropertyTypes`, `topic: undefined` is not the same as no `topic`, and the test checks with `toStrictEqual`.)

## Exercise 7a
Fill in `runDaily` in `src/scheduler.ts` (see `TODO(human)`):
```bash
cd server
npx vitest run test/scheduler.test.ts
npx vitest run test/store.test.ts -t "open"   # the given listOpen, should already be green
npx vitest run                                 # everything
```

## Food for thought
- Claude is down all day. The job makes 0 exercises and reports 3 failures. What happens the next morning? And if Claude is down for a week?
- `listOpen()` gets **all** open exercises once, and you filter per language. The alternative is a `listOpen({ lang })`, like `list`, with three queries. Which would you choose with 10 exercises? With 100,000?
- You solve your cpp exercise at 07:05, right after the job ran. Your next cpp exercise comes tomorrow. Should solving an exercise trigger the job too? Where in the code would that go?
- Without a `topic`, will the LLM pick "generics" for TS every time? What information could you give it (that's already in your database) to make it pick something new?
