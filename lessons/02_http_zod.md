# 02 – Validation with zod, then an HTTP server with Fastify

Milestone 2 has two steps:
- **2a – `src/schemas.ts`**: zod schemas (this lesson, part A)
- **2b – `src/app.ts`**: Fastify routes that use those schemas (part B, comes after 2a)

---

# Part A – zod: types that also exist at runtime

## The problem
Your types from milestone 1 only exist in `tsc`. At runtime they're gone. So this compiles fine:
```ts
const body = JSON.parse(request) as Exercise;   // "trust me"
body.difficulty;                                // can still be 12, or "hard", or missing
```
`as` is a promise to the compiler, not a check. For data coming from **outside** (an HTTP body, LLM output, a file) you need a real check that runs at runtime. That's what zod is for.

## A schema = a runtime checker + a type
```ts
import { z } from "zod";

const UserSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0),
});

type User = z.infer<typeof UserSchema>;   // { name: string; age: number }
```
`z.infer` derives the type from the schema, like `(typeof LANGUAGES)[number]` in milestone 1. It's the same bridge from the value world to the type world.

## parse vs safeParse
```ts
UserSchema.parse(data);        // returns User, or THROWS a ZodError
const r = UserSchema.safeParse(data);
if (r.success) r.data;         // User
else r.error.issues;           // list of what's wrong (path + message)
```
`safeParse` returns a **discriminated union** on `success`, the same pattern as your `CheckResult`.

## The building blocks you need
| zod | type | note |
|---|---|---|
| `z.string()` | `string` | `.min(n)`, `.max(n)` = length |
| `z.number().int().min(a).max(b)` | `number` ⚠️ | range is checked, but the type stays `number` |
| `z.literal("a")` | `"a"` | |
| `z.literal(["a", "b"])` | `"a" \| "b"` | zod 4: several literals at once, numbers work too |
| `z.enum(ARRAY)` | union of the elements | accepts your `as const` array directly |
| `z.iso.datetime()` | `string` | checks for an ISO string like `2026-10-16T07:00:00.000Z` |
| `z.object({...})` | object | unknown extra keys are dropped by default |

⚠️ Look closely at the `z.number().int().min(1).max(10)` row. The *check* is right, but the inferred type is `number`, not `Difficulty`. The test checks that `z.infer` equals your `Exercise` **exactly**, so that won't be enough.

## Optional fields and `exactOptionalPropertyTypes`
This is the tricky part. In your tsconfig:
```ts
interface A { x?: string }              // x may be MISSING
interface B { x?: string | undefined }  // x may be missing OR be undefined
```
With `exactOptionalPropertyTypes` on, those are **two different types**. And zod:
```ts
z.object({ x: z.string().optional() })        // infers  { x?: string | undefined }  → B
z.object({ x: z.exactOptional(z.string()) })  // infers  { x?: string }              → A
```
Which one matches your `Exercise.prompt`?

## Reading the type test
```ts
expectTypeOf<z.infer<typeof ExerciseSchema>>().toEqualTypeOf<Exercise>();
```
If they differ, you get a **cryptic** error:
```
error TS2554: Expected 1 arguments, but got 0.
```
That means the types don't match. To find out where, hover with `K` in nvim over `z.infer<typeof ExerciseSchema>`, or temporarily write:
```ts
const check: Exercise = {} as z.infer<typeof ExerciseSchema>;
```
tsc then names the exact field that differs.

## Two sources of truth?
You now have `Exercise` (interface) **and** `ExerciseSchema`. The type test keeps them in sync: if you add a field to the interface and forget the schema, tsc fails. (The alternative is to delete the interface and use `type Exercise = z.infer<typeof ExerciseSchema>`. That's a common approach too, but then `types.ts` depends on zod. We'll keep the interface as a readable contract.)

## Exercise 2a
Fill in `server/src/schemas.ts` (see `TODO(human)`). Read `test/schemas.test.ts` first:
- which fields must **not** be empty?
- which limits apply to `topic` and `code`?
- reuse `LANGUAGES` from `./types.js`

```bash
cd server && npm test
```

Food for thought: you'll notice that many fields are "a non-empty string". How do you avoid writing `z.string().min(1)` nine times?

---

# Part B – Fastify: your first HTTP server

## What's already there
| file | who | what |
|---|---|---|
| `src/store.ts` | given | `ExerciseStore` interface + `MemoryStore` (a Map). In milestone 3 you write a SQLite version with the **same interface**. |
| `src/main.ts` | given | creates a store with 1 sample exercise, calls `buildApp`, starts listening on port 3000 |
| `src/app.ts` | **you** | `buildApp(store)`: all the routes |
| `test/app.test.ts` | given | the spec |

Read `store.ts` first. It's short, and you'll be using `store.get()` and `store.list()`.

## Why `buildApp` and not just `app.listen()` straight away?
`buildApp` *builds* the app but doesn't start it. That gives you two ways to use it:
- `main.ts` → `app.listen()`: a real server on a port
- tests → `app.inject()`: Fastify simulates a request **without a network**. That's fast, there are no port conflicts, and every test gets a fresh app.

The store is passed in as a **parameter** (dependency injection) instead of being created inside `buildApp`. That way the tests can pass in their own `MemoryStore` with known data, and later `main.ts` can pass in a SQLite store.

## A route
```ts
app.get("/ping", async (request, reply) => {
  return { pong: true };          // returned object → 200 + JSON
});
```
- **return a value**: Fastify sends it as JSON with status 200
- **another status**: `return reply.code(404).send({ error: "..." });`
  The `return` matters: without it your handler keeps running after the `send`.

## Params, query and body
```ts
// GET /users/42?verbose=true   POST with JSON body
request.params   // { id: "42" }          from the URL pattern /users/:id
request.query    // { verbose: "true" }   always strings!
request.body     // the parsed JSON body  (unknown, so validate it)
```
To type `params`, give the route a **generic**:
```ts
app.get<{ Params: { id: string } }>("/users/:id", async (request, reply) => {
  request.params.id;   // string, TS knows this now
});
```
**Don't** do that for `body` and `query`: they come from outside. Typing them as `{ code: string }` is a lie to TS (the same as `as`). Use `safeParse` and let zod tell you what's really there.

## Validation in a handler
```ts
app.post("/users", async (request, reply) => {
  const parsed = UserSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid body", issues: parsed.error.issues });
  }
  parsed.data;   // fully typed and checked from here on
});
```
For `?lang=` you need a small schema for the **query**. It doesn't exist yet, so write one yourself: in `schemas.ts`, or inline in `app.ts`. Watch out: `?lang` is optional, so... you know which `optional` by now. And what does your `store.list()` expect when there's no `lang`?

## Status codes you need
| code | meaning | when |
|---|---|---|
| 200 | OK | all good |
| 400 | Bad Request | the client sent something invalid (body/query) |
| 404 | Not Found | the thing doesn't exist (unknown id) |
| 501 | Not Implemented | the route exists, but the functionality is still missing |

The 501 is honest: `submit` and `generate` validate their input properly now, but the runner (milestone 4) and generator (milestone 5) don't exist yet. Later you'll only replace the 501 with the real work, and the validation stays.

## Watch out: a 404 you didn't write yourself
Fastify returns a **404 with an `error` field by itself** for routes that don't exist. So without any code, two 404 tests already pass. Once you register `/exercises/:id`, Fastify's 404 no longer applies there, and the test only passes if *your* code returns the 404. Don't let a green test fool you before your route even exists.

## Running it for real
```bash
cd server && npm run dev          # tsx watch: restarts on every save
```
In another pane:
```bash
curl localhost:3000/health
curl localhost:3000/exercises
curl localhost:3000/exercises/ts-0001
curl -X POST localhost:3000/exercises/generate \
  -H 'content-type: application/json' -d '{"lang":"rust"}'
```
`-H 'content-type: application/json'` matters: without it, Fastify doesn't parse the body as JSON.

## Exercise 2b
Fill in `server/src/app.ts` (see `TODO(human)`). One route at a time. Start with `/health`, run `npm test`, then the next one.

Food for thought: in `POST /exercises/:id/submit` you check two things, the body (400) and whether the exercise exists (404). Which do you check **first**, and why? The tests allow both orders.
