// The HTTP API. buildApp() creates a Fastify instance with all routes but does
// NOT start listening: main.ts does that, and the tests use app.inject() instead.
// Lesson: ../lessons/02_http_zod.md (part B)
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import type { ExerciseStore } from "./store.js";
import {
  QueryListSchema,
  GenerateRequestSchema,
  SubmitRequestSchema,
} from "./schemas.js";
export function buildApp(
  store: ExerciseStore,
  opts: FastifyServerOptions = {},
): FastifyInstance {
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
      return reply.code(501).send({ error: "not implemented" });
    },
  );
  app.post("/exercises/generate", async (request, reply) => {
    const parsedBody = GenerateRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.code(400).send({ error: "bad body" });
    }
    return reply.code(501).send({ error: "not implemented" });
  });

  return app;
}
