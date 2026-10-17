# 01 – TS basics: types as a contract

You know JS. TS is JS plus a type system that **only exists at compile time**: `tsc` checks your types and then erases them. At runtime it's just JS. You need to know that difference for this milestone: some things exist only as a type, others also as a value.

## Tooling in `server/`
| command | what it does |
|---|---|
| `npx tsx src/x.ts` | run TS directly (strips types, no checking) |
| `npm run typecheck` | `tsc --noEmit`: only checks, writes nothing |
| `npm test` | typecheck + vitest |

`tsconfig.json` is strict on purpose: `strict`, `noUncheckedIndexedAccess` (`arr[0]` is `T | undefined`), `exactOptionalPropertyTypes` (`prompt?: string` does **not** allow `prompt: undefined`).

## 1. Literal & union types
```ts
type Status = "open" | "done";      // only these two strings
let s: Status = "open";
s = "closed";                       // ✗ compile error
```

## 2. Deriving a type from a value: `as const` + indexed access
Keep one source of truth. If you need a list at runtime (for validation), derive the type from it:
```ts
const COLORS = ["red", "green"] as const;   // readonly ["red", "green"]
type Color = (typeof COLORS)[number];       // "red" | "green"
```
- `as const` makes it readonly **and** keeps the literals (otherwise it would be `string[]`)
- `typeof X` = the type of a value; `[number]` = "the type of any element"

## 3. Type guards
TS narrows types after checks (`typeof x === "string"`). With a **user-defined type guard** you make your own:
```ts
function isColor(s: string): s is Color {
  return (COLORS as readonly string[]).includes(s);
}
```
Why the `as readonly string[]`? `COLORS.includes` only accepts a `Color`, and you're passing in an arbitrary string. Try it without the cast and read the error.

## 4. Interfaces & optional fields
```ts
interface User {
  id: string;
  nickname?: string;     // may be missing
}
```
`interface` vs `type`: for object shapes both are fine. Unions can only be written with `type`.

## 5. Discriminated unions
A union of objects that all share one literal field (the "discriminant"):
```ts
type Shape =
  | { kind: "circle"; r: number }
  | { kind: "square"; side: number };

function area(s: Shape) {
  if (s.kind === "circle") return Math.PI * s.r ** 2;  // TS knows: s.r exists
  return s.side ** 2;
}
```
This is the most important pattern in this project: the runner returns a `CheckResult`, and the CLI/web UI branch on `status`. You can only reach `output` once you've checked that it exists.

## 6. `import type`
With `verbatimModuleSyntax`, you import types explicitly as types:
```ts
import { LANGUAGES, type Language } from "./types.js";
```
Note the **`.js`** extension even though the file is `.ts`. Node ESM needs real paths, and tsc maps `.js` → `.ts`.

## Exercise
Fill in `server/src/types.ts` (see `TODO(human)`). The tests in `test/types.test.ts` are the spec. Read them, especially the `@ts-expect-error` lines: those are places where your types **must** produce a compile error.

```bash
cd server && npm test
```

Food for thought: `Difficulty` is a type with 10 numbers. How do you guarantee at runtime that an LLM doesn't hand you `difficulty: 12`? (That's milestone 2/5: zod.)
