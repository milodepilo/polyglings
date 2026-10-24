// The server's HTTP API as typed functions. Every CLI command goes through here,
// so this is the only file that knows about URLs, fetch and status codes.
// Lesson: ../../lessons/08_cli.md (part A)
import type { Progress } from "../../server/src/progress.js";
import {
  CheckResultSchema,
  ExerciseSchema,
  ProgressSchema,
} from "../../server/src/schemas.js";
import type {
  CheckResult,
  Exercise,
  Language,
} from "../../server/src/types.js";

// Anything with a parse() that returns a T or throws. A zod schema is one, but TS only
// checks the shape: { parse: (x) => String(x) } is a Parser<string> too.
export interface Parser<T> {
  parse(data: unknown): T;
}

// The server answered, but not with 2xx.
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown; // the error body as JSON, or as text if it wasn't JSON

  constructor(status: number, body: unknown) {
    const detail =
      typeof body === "object" && body !== null && "error" in body
        ? `: ${String(body.error)}`
        : "";
    super(`server answered ${status}${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// The server didn't answer at all: not running, wrong address, Pi off.
export class ServerUnreachableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(`cannot reach the server at ${baseUrl}`, { cause });
    this.name = "ServerUnreachableError";
  }
}

export interface Api {
  list(lang?: Language): Promise<Exercise[]>;
  get(id: string): Promise<Exercise>;
  submit(id: string, code: string): Promise<CheckResult>;
  generate(lang: Language, topic?: string): Promise<Exercise>;
  progress(): Promise<Progress>;
}

type Method = "GET" | "POST";

// fetchFn: the real fetch by default; tests pass a fake for answers the real server never gives
export function createApi(baseUrl: string, fetchFn: typeof fetch = fetch): Api {
  async function request<T>(
    method: Method,
    path: string,
    parser: Parser<T>,
    body?: unknown,
  ): Promise<T> {
    let result: Response;
    const url = new URL(path, baseUrl);
    try {
      result = await fetchFn(url, {
        method,
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
    } catch (err) {
      throw new ServerUnreachableError(baseUrl, err);
    }
    const text = await result.text();
    if (!result.ok) {
      let resultBody: unknown;
      try {
        resultBody = JSON.parse(text);
      } catch {
        resultBody = text;
      }
      throw new ApiError(result.status, resultBody);
    }

    // TODO(human): milestone 8a (lesson: lessons/08_cli.md part A)
    //   - the URL is baseUrl + path; a trailing slash on baseUrl must not matter
    //   - with a body: send it as JSON (and say so in a header)
    //   - fetch itself fails (nobody answers) → ServerUnreachableError
    //   - not 2xx → ApiError with the status and the body (JSON if it is JSON, text otherwise)
    //   - 2xx → the JSON body, checked by `parser`
    //   spec: test/api.test.ts
    return parser.parse(JSON.parse(text));
  }

  // given: every endpoint is one request() call
  const exercisePath = (id: string) => `/exercises/${encodeURIComponent(id)}`;
  return {
    list: (lang) =>
      request(
        "GET",
        lang === undefined ? "/exercises" : `/exercises?lang=${lang}`,
        ExerciseSchema.array(),
      ),
    get: (id) => request("GET", exercisePath(id), ExerciseSchema),
    submit: (id, code) =>
      request("POST", `${exercisePath(id)}/submit`, CheckResultSchema, {
        code,
      }),
    generate: (lang, topic) =>
      request(
        "POST",
        "/exercises/generate",
        ExerciseSchema,
        topic === undefined ? { lang } : { lang, topic },
      ),
    progress: () => request("GET", "/progress", ProgressSchema),
  };
}
