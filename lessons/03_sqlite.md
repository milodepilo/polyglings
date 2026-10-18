# 03 – SQLite: exercises that survive a restart

`MemoryStore` keeps everything in a `Map`. Restart the server and everything's gone. In this milestone you write `SqliteStore`: the **same interface** (`ExerciseStore`), but stored in a file.

## What's already there
| file | what |
|---|---|
| `src/sqlite-store.ts` | the skeleton: the class, methods that throw, `close()` |
| `test/store.test.ts` | **contract tests**: the same tests run against `MemoryStore` *and* `SqliteStore` |

`MemoryStore` already passes the tests. So if `SqliteStore` fails, the bug is in your code, not in the test. That's the strength of an interface plus contract tests.

## SQLite in 30 seconds
- A full SQL database in **one file**. No server, no installation, no password.
- Ideal for one app on one machine, like your Pi.
- Node 22 has it **built in**: `node:sqlite`. No npm package needed, and no native compiling on the Pi.

You'll see this warning, and it's harmless:
```
ExperimentalWarning: SQLite is an experimental feature and might change at any time
```
The API is stable enough for this. It just doesn't have the official "stable" label yet in Node 22.

## The node:sqlite API
```ts
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("app.db");      // or ":memory:" for a database that only lives in RAM

db.exec(`CREATE TABLE ...`);                // run SQL, no result

const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
stmt.get("42");        // first row as an object, or undefined
stmt.all();            // all rows as an array
stmt.run(...values);   // for INSERT/UPDATE/DELETE: returns { changes, lastInsertRowid }
```
It's **synchronous** (`DatabaseSync`): no `await`. That matches your `ExerciseStore` interface, which has no Promises either. For a small server on a Pi, that's fine: SQLite on an SSD is fast.

## Creating a table
```sql
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,   -- unique, so a second row with the same id isn't allowed
  name       TEXT NOT NULL,      -- required
  age        INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  nickname   TEXT                -- no NOT NULL, so it may be NULL (= optional)
);
```
- **`IF NOT EXISTS`** is essential: the constructor runs on *every* start. Without it, the second start fails because the table already exists (the "on disk" test checks for that).
- SQLite has few types: `TEXT`, `INTEGER`, `REAL`, `BLOB`. A `Language` is simply `TEXT`, and a `Difficulty` is `INTEGER`.
- Column names in SQL are conventionally `snake_case`, so `created_at`, not `createdAt`.

## ⚠️ Placeholders, never string concatenation
```ts
// ✗ NEVER
db.prepare(`SELECT * FROM users WHERE id = '${id}'`).get();
// ✓ ALWAYS
db.prepare("SELECT * FROM users WHERE id = ?").get(id);
```
With concatenation, an id like `x' OR '1'='1` becomes part of your SQL:
`WHERE id = 'x' OR '1'='1'` is always true, so you get a random row back. That's **SQL injection**. With `?`, SQLite sends the value separately from the SQL, so it's always treated as data, never as code. There's a test that checks exactly this.

## Insert or replace?
`MemoryStore.add` uses `Map.set`: if the id already exists, it's replaced. Your SQL version has to do the same. A normal `INSERT` fails on an existing `PRIMARY KEY`. Look up:
- `INSERT OR REPLACE INTO ...`, or
- `INSERT INTO ... ON CONFLICT(id) DO UPDATE SET ...` (an "upsert")

The first one is simpler. The second is more precise (it updates the row instead of deleting and re-inserting it). Both are fine here.

## From row to Exercise: the real work
A row from SQLite **isn't** an `Exercise` yet:
```ts
db.prepare("SELECT * FROM users WHERE id = ?").get("42");
// { id: "42", name: "Ada", age: 36, created_at: "2026-...", nickname: null }
```
Three differences you have to bridge:
1. **`created_at` → `createdAt`**: different name
2. **`null` → missing key**: SQL has no "missing", only `NULL`. Your `Exercise` says `prompt?: string`, and with `exactOptionalPropertyTypes` that means the key isn't there at all. `{ prompt: null }` and `{ prompt: undefined }` are both wrong. The test uses `toStrictEqual`, which sees that difference.
3. **The type**: TS types `get()` as `Record<string, SQLOutputValue> | undefined`, a bag of unknown values. TS doesn't know it's an `Exercise`.

Handy tricks:
```ts
// rename + remove: destructuring with a rest
const { created_at, nickname, ...rest } = row;

// add a key only if there's a value (conditional spread)
const user = { ...rest, createdAt: created_at, ...(nickname === null ? {} : { nickname }) };
```

For point 3 you have two options:
- **`as Exercise`**: fast, but it's a promise without a check
- **`ExerciseSchema.parse(...)`**: your schema from milestone 2 checks that the database really contains what you think it does. If an old row is broken, you get a clear error instead of a strange bug three steps later.

Tip: put the conversion in **one** private method (e.g. `private toExercise(row)`), because `get` and `list` both need it.

## Inspecting your database
```bash
sudo apt install sqlite3          # on WSL, if you don't have it yet
sqlite3 polyglings.db
sqlite> .tables
sqlite> .schema exercises
sqlite> SELECT id, lang, topic FROM exercises;
sqlite> .quit
```

## Exercise 3
Fill in `src/sqlite-store.ts` (see `TODO(human)`). Suggested order, running `npm test` after each step:
1. `CREATE TABLE IF NOT EXISTS` in the constructor
2. `add`
3. `get` plus your row→Exercise conversion
4. `list`, with and without `lang`

Once everything is green, we'll wire `SqliteStore` into `main.ts`.

Food for thought: `list()` has no `ORDER BY`. The tests sort the ids themselves because SQL makes no promise about order. What order would you want for a list of exercises in the CLI later, and which column is ideal for that?
