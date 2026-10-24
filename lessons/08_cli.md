# 08 – CLI: your server's first real client

So far you've only talked to your server with `curl` and `app.inject()`. In this milestone you build `polyglings`, the command you use every day on WSL:

```bash
polyglings sync          # fetch new exercises → files in ~/polyglings-work
polyglings watch         # submit every time you save, show pass/fail
polyglings hint <id>
polyglings new ts "generics"
polyglings progress
```

Three parts:
- **8a**: `cli/src/api.ts`, the API client. Typed functions instead of URLs, and the only place that knows about HTTP.
- **8b** (next): the workspace: write exercises to files, without overwriting your work.
- **8c**: the commands and `watch`.

## A second package
`cli/` is its own package, next to `server/`: its own `package.json`, `tsconfig.json`, tests. It runs on WSL; the server runs on the Pi.

But it doesn't **copy** the types. It imports them straight from the server:
```ts
import type { CheckResult, Exercise, Language } from "../../server/src/types.js";
import { CheckResultSchema, ExerciseSchema, ProgressSchema } from "../../server/src/schemas.js";
```
Rename a field in `types.ts`, and `tsc` in `cli/` fails right away. With a copy, you'd only find out when the CLI breaks. (The `"rootDir": ".."` in `cli/tsconfig.json` is what allows files from outside `cli/`.)

zod itself isn't a dependency of `cli/`: the schemas come from the server's files, and they bring their own zod along from `server/node_modules`.

## The server is "outside" now
In milestone 2 the server checked everything that came **in**: request bodies. Now you're on the other side, and the server's answer is what comes in. The same rule applies: **check at the border**.

```ts
// example: a weather app (not your code!)
const data = await res.json();          // type: any. TS believes anything you say about it
const temp: number = data.main.temp;    // no error from TS... and undefined at runtime if the API changed
```
`res.json()` returns `Promise<any>`. That's not a type, it's TS giving up. Parse it, and from then on the type is real.

## `fetch` in 5 points
Node 22 has `fetch` built in, the same as in the browser.
```ts
// example: the GitHub API
const res = await fetch("https://api.github.com/users/octocat", {
  method: "POST",                                   // default "GET"
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "x" }),             // a string, not an object
});
res.status;          // 200, 404, ...
res.ok;              // true for 200-299
await res.text();    // the body as a string
await res.json();    // the body, parsed as JSON (throws if it isn't JSON)
```
1. **`fetch` only rejects when there's no answer at all**: the server is off, wrong address, no network. A 404 or 500 **is** an answer: `fetch` resolves, with `res.ok === false`. Many people expect a 404 to throw; it doesn't. You decide what an error is.
2. **The body is a stream, and you can only read it once.** `await res.json()` and then `await res.text()` on the same response throws "body used already". If you don't know yet whether it's JSON, read it as text first; then you can try `JSON.parse` on it yourself.
3. **`body` has to be a string.** `JSON.stringify` it yourself.
4. **The `content-type` header tells the server what the body is.** Without it, `fetch` labels your string as `text/plain`, and Fastify hands your route... a string. `'{"code":"..."}'` instead of `{ code: "..." }`. Your zod schema then says "expected object, received string" → 400. Confusing, because the JSON itself is fine.
5. **The URL is a string you build yourself**, so `"http://pi:3000/" + "/progress"` becomes `http://pi:3000//progress`. Whether that works depends on the server. The test with a trailing slash expects it to work anyway.

## Wrapping an error: `cause`
When the Pi is off, `fetch` rejects with `TypeError: fetch failed`. That's true, but it doesn't help: what failed? So you throw your own error, and you keep the original inside it:
```ts
// example: reading a config file
try {
  return readFileSync(path, "utf8");
} catch (err) {
  throw new Error(`cannot read config ${path}`, { cause: err });   // the original isn't lost
}
```
`ServerUnreachableError` is given, and already passes `cause` along. You decide **where** to catch: only around the `fetch` call. A `try` around everything would also turn a 404 or a zod error into "cannot reach the server", and that's not true.

## A generic function with a parser
`request` is generic: `request<T>(..., parser: Parser<T>)`. You never write the `T` yourself: TS **infers** it from the parser you pass in:
```ts
request("GET", "/progress", ProgressSchema)    // T = Progress, because ProgressSchema.parse returns that
```
`Parser<T>` is just an interface with a `parse` method. A zod schema has one, so it fits, even though zod has never heard of your `Parser`. TS checks **shapes**, not names or origins. That's called **structural typing**:
```ts
// example
interface HasName { name: string }
const dog = { name: "Rex", barks: true };
const n: HasName = dog;    // ✓ it has a name: string, the extra field doesn't matter
```

## Two kinds of errors from the server
| situation | what the server sends | what your `request` throws |
|---|---|---|
| exercise doesn't exist | 404 `{ "error": "exercise not found" }` | `ApiError` 404, body = that object |
| generator gave up | 502 `{ "error": ..., "reasons": [...] }` | `ApiError` 502, body with the reasons (the CLI shows them) |
| a proxy in between | 502 `<html>Bad Gateway</html>` | `ApiError` 502, body = that text |

`ApiError` (given) makes its own message out of the `error` field, if there is one.

## Tests against the real server
`cli/test/api.test.ts` starts your **real** `buildApp` (with a fake checker and generator) on `port: 0`: the OS picks a free port, so tests never clash with your dev server on 3000. Your client talks to it over real HTTP. If you change a route in the server, these tests break, and that's the point.

Two answers the real server never gives (a non-JSON error, a 200 with the wrong shape) are tested with a fake `fetch`. That's why `createApi` takes a `fetchFn`: the same dependency-injection idea as `checker` in milestone 4.

## Exercise 8a
Fill in `request` in `cli/src/api.ts` (see `TODO(human)`):
```bash
cd cli
npx vitest run
npx tsc --noEmit
```

## Food for thought
- `GET /exercises/:id` also returns the `solution` and the `hint`. Your CLI can show the hint only when you ask for it, but anyone with curl can read the solution. Should the server hide it? What would you need to change, and what would break?
- `fetch` waits forever by default. Generating takes 30–60 seconds; what if the Pi hangs? Search for `AbortSignal.timeout`. Should `generate` get a different timeout from `progress`?
- The Pi is unreachable for a moment while you're in `watch`. Should the CLI retry, or report it and keep watching?
