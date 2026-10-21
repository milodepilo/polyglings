# 06 – Progress: your level, computed from your history

Your generate route still has a hard-coded `difficulty: 1`. In this milestone, the server learns what your level is per language, so new exercises get harder as you solve more.

Two parts:
- **6a** (now): `src/progress.ts`, a pure function: list of solved exercises in → level per language out.
- **6b** (later): store submissions in SQLite, `GET /progress`, and the generate route uses your level.

## The rules
| rule | why |
|---|---|
| every language starts at level 1 | you start fresh with each language |
| a solve **at or above** your level counts toward the next level | that's proof you can handle this level |
| a solve **below** your level doesn't count | an old level-1 exercise you only solve now proves nothing about level 3 |
| 3 counting solves → level + 1, the counter goes back to 0 | not too fast (a single lucky solve), not too slow |
| at level 10 it stops | there's no level 11; the counter stays at 0 |
| failures don't count against you | with watch mode, every save is a submission, and failing while you're working is normal |

"Solved" means: an exercise with at least one `pass`. An exercise you solve 5 times still counts once. 6b makes sure of that, by passing only the **first** `pass` per exercise to `computeProgress`.

## Derive, don't store
The obvious approach is a `level` column you increase on each pass. The alternative: **store only what happened** (submissions), and compute the level from that whenever you need it.

```ts
// example: a loyalty card (not your code!)
// stored: only the purchases.  Computed: the tier.
function tier(purchases: Purchase[]): "bronze" | "silver" | "gold" {
  const total = purchases.reduce((sum, p) => sum + p.amount, 0);
  return total >= 1000 ? "gold" : total >= 250 ? "silver" : "bronze";
}
```
Advantages:
- **Rules change easily**: tomorrow you want 4 solves instead of 3? Change the constant, and every level is correct right away. With a stored level, you'd have to "replay" every user.
- **No drift**: a stored level can disagree with the history (a bug, a crash halfway through an update). A computed one can't.
- **Testable**: a pure function needs no database in its tests.

The cost: computing it every time. For a few hundred solves that's microseconds. Only with millions of events would you start caching.

### Pure functions
`computeProgress` is **pure**: the same input always gives the same output, and it changes nothing outside itself. No `Date.now()`, no database, and **no changes to its input**. That last one is a test.

## Things you'll need

### Sorting without changing the input
`array.sort()` sorts **in place**: it changes the array you were given. The caller doesn't expect that.
```ts
const prices = [30, 10, 20];
const sorted = prices.sort((a, b) => a - b);   // ✗ prices is now [10, 20, 30] too
const sorted2 = [...prices].sort((a, b) => a - b);   // ✓ sort a copy
const sorted3 = prices.toSorted((a, b) => a - b);    // ✓ ES2023: returns a new array
```
The compare function returns a **negative** number (a before b), **0** (equal), or **positive** (b before a).

### ISO timestamps sort as text
`"2026-10-20T08:05:00.000Z"`: largest unit first, fixed width, zero-padded. So **alphabetical order = time order**. You don't need to make `Date`s; comparing strings is enough:
```ts
names.sort((a, b) => a.localeCompare(b));   // string comparison: -1, 0 or 1
```
(This only works because all timestamps are in the same format and time zone, the `Z` from `toISOString()`.)

### An object with a key for every language
`Progress` is `Record<Language, LangProgress>`, so all three keys **must** be there, even for a language you've never touched. You can build that by looping over `LANGUAGES` (from `types.ts`). TS doesn't know that a loop fills all keys, so you start with:
```ts
const scores = {} as Record<Player, number>;   // "trust me, I'll fill it"
for (const p of PLAYERS) scores[p] = 0;
```
`as` is a promise to TS that you keep yourself. Use it only when you really fill it right after. (Alternative: `Object.fromEntries(...)`, but that returns `{ [k: string]: ... }`, so you need an `as` there too.)

### Arithmetic with literal types
`level` is a `Difficulty` (`1 | 2 | ... | 10`). But:
```ts
const stars: Rating = 4;          // Rating = 1 | 2 | 3 | 4 | 5
const next = stars + 1;           // type: number, not Rating!
const r: Rating = stars + 1;      // ✗ TS error
```
TS can't calculate with literal types: `4 + 1` is just a `number`. You know it stays ≤ 10 (because of your cap). Telling TS that is an `as` again, but only **after** the check that guarantees it. Think about where in your code that check sits.

## Exercise 6a
Fill in `computeProgress` in `src/progress.ts` (see `TODO(human)`):
```bash
npx vitest run test/progress.test.ts
```
Read the tests first: they're the spec. Pay special attention to "uses your level at the moment of each solve". That's the test that shows why you have to walk through the solves in order, rather than just counting.

## Food for thought
- Failures don't count now. Should "solved after 1 submission" count more than "solved after 30"? What would you need for that, and where do you get it from in 6b?
- Can you go back down a level? When would that be useful, and why is that annoying for motivation?
- What if you (or Claude) misjudge a level-5 exercise and it's really level 2? How could the generator use your progress to calibrate itself?
