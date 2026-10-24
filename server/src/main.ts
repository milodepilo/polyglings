// Entry point: wire a store into the app and start listening.
// Dev:  npm run dev   (restarts on file changes)
import { buildApp } from "./app.js";
import { claudeCli, generateExercise, type GenerationRequest } from "./generator.js";
import { check } from "./runner.js";
import { runDaily, startScheduler } from "./scheduler.js";
import { SqliteStore } from "./sqlite-store.js";

const store = new SqliteStore(process.env.DB_PATH ?? "polyglings.db");
if (store.list().length === 0) {
  store.add({
    id: "ts-0001",
    lang: "ts",
    topic: "generics",
    difficulty: 2,
    description:
      "Write a generic function `first` that returns the first element of an array, or undefined.",
    starter: "export function first(xs) {}\n",
    tests: "import { first } from './main';\n// ...\n",
    hint: "Use a type parameter: first<T>(xs: T[]): T | undefined",
    solution:
      "export function first<T>(xs: T[]): T | undefined {\n  return xs[0];\n}\n",
    createdAt: new Date().toISOString(),
  });
}
// one generate for both the route and the daily job (milestone 7b, given)
const generate = (req: GenerationRequest) =>
  generateExercise(req, { llm: claudeCli(), checker: check });
const app = buildApp({ store, generate }, { logger: true });

// The daily job (milestone 7b, given). SCHEDULER=off turns it off, DAILY_HOUR sets the hour.
if (process.env.SCHEDULER !== "off") {
  const hour = Number(process.env.DAILY_HOUR ?? 7);
  const scheduler = startScheduler({
    hour,
    run: async () => {
      const { added, failed, skipped } = await runDaily({ store, generate });
      app.log.info({ added: added.map((e) => e.id), failed, skipped }, "daily run");
    },
    onError: (err) => app.log.error({ err }, "daily run crashed"),
  });
  app.addHook("onClose", () => scheduler.stop());
  app.log.info(`daily run at ${hour}:00 local time`);
}
const port = Number(process.env.PORT ?? 3000);

// 0.0.0.0 = reachable from other machines too (needed on the Pi), not just localhost
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
app.addHook("onClose", () => store.close());
