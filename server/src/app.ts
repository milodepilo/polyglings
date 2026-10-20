// The HTTP API. buildApp() creates a Fastify instance with all routes but does
// NOT start listening: main.ts does that, and the tests use app.inject() instead.
// Lesson: ../lessons/02_http_zod.md (part B)
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import type { ExerciseStore } from "./store.js";
import { check, type Checker } from "./runner.js";
import {
  claudeCli,
  generateExercise,
  GenerationError,
  type GenerationRequest,
} from "./generator.js";
import type { Exercise } from "./types.js";
import {
  QueryListSchema,
  GenerateRequestSchema,
  SubmitRequestSchema,
} from "./schemas.js";

// Everything the routes depend on. Only the store is required: the others default
// to the real thing, and tests pass fakes (lesson 04 part 4, lesson 05 part 4).
export interface AppDeps {
  store: ExerciseStore;
  checker?: Checker;
  generate?: (req: GenerationRequest) => Promise<Exercise>;
}

export function buildApp(
  deps: AppDeps,
  opts: FastifyServerOptions = {},
): FastifyInstance {
  const {
    store,
    checker = check,
    generate = (req) => generateExercise(req, { llm: claudeCli(), checker }),
  } = deps;
  const app = Fastify(opts);

  app.get("/health", async () => {
    return { ok: true }; // returned object → 200 + JSON
  });
  app.get("/exercises", async (request, reply) => {
    const parsed = QueryListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid Language", issues: parsed.error.issues });
    }
    return store.list(parsed.data); // returned object → 200 + JSON
  });
  app.get<{ Params: { id: string } }>(
    "/exercises/:id",
    async (request, reply) => {
      const exerciseById = store.get(request.params.id);
      if (exerciseById === undefined) {
        return reply.code(404).send({ error: "exercise not found" });
      }
      return exerciseById;
    },
  );
  app.post<{ Params: { id: string } }>(
    "/exercises/:id/submit",
    async (request, reply) => {
      const exerciseById = store.get(request.params.id);
      const parsedBody = SubmitRequestSchema.safeParse(request.body);
      if (exerciseById === undefined) {
        return reply.code(404).send({ error: "exercise not found" });
      } else if (!parsedBody.success) {
        return reply.code(400).send({ error: "bad body" });
      }
      return checker(
        exerciseById.lang,
        parsedBody.data.code,
        exerciseById.tests,
      );
    },
  );
  app.post("/exercises/generate", async (request, reply) => {
    const parsedBody = GenerateRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "bad body" });
    }
    const { lang, topic } = parsedBody.data;
    try {
      const exercise = await generate({
        lang,
        difficulty: 1,
        ...(topic !== undefined ? { topic } : {}),
      });
      store.add(exercise);
      return reply.code(201).send(exercise);
    } catch (err) {
      if (err instanceof GenerationError) {
        return reply
          .code(502)
          .send({ error: "no exercise generated", reasons: err.reasons });
      }
      throw err;
    }
  });

  return app;
}
