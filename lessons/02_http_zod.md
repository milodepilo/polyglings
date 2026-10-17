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

# Part B – Fastify
*(follows after 2a)*
