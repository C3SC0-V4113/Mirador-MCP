import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { Env } from "./env.js";

export type IntentMode = "responder" | "analizar" | "reporte_visual" | "plan";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const coreAskResultSchema = z.object({
  trace_id: z.string(),
  answer: z.string(),
  answer_source: z.string().nullable(),
  metric: z.string().nullable(),
  data: z.array(z.record(z.string(), jsonValueSchema)),
  source_views: z.array(z.string()),
  validated_sql: z.string().nullable(),
  chart_hint: z
    .object({
      type: z.string(),
      x: z.string().nullable(),
      y: z.string()
    })
    .nullable(),
  citations: z.array(
    z.object({
      document_id: z.string(),
      title: z.string(),
      locator: z.string()
    })
  ),
  warnings: z.array(z.string()),
  suggested_questions: z.array(z.string())
});

export type CoreAskResult = z.infer<typeof coreAskResultSchema>;
export type BusinessSchemaContext = JsonValue;

const retryableStatuses = new Set([500, 502, 503, 504]);

export class CoreClientError extends Error {
  constructor(
    message: string,
    public readonly code: "CORE_UNAUTHORIZED" | "CORE_NOT_CONFIGURED" | "CORE_HTTP_ERROR" | "CORE_TIMEOUT" | "CORE_UNEXPECTED_RESPONSE",
    public readonly status?: number,
    public readonly traceId?: string
  ) {
    super(message);
    this.name = "CoreClientError";
  }
}

export type CoreClientOptions = {
  timeoutMs?: number;
  retryDelayMs?: number;
  fetchFn?: typeof fetch;
};

export class CoreClient {
  private readonly baseUrl: URL;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly env: Pick<Env, "CORE_INTERNAL_URL" | "CORE_SERVICE_TOKEN">, options: CoreClientOptions = {}) {
    this.baseUrl = new URL(env.CORE_INTERNAL_URL);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs ?? 150;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async ask(input: { question: string; intent_mode?: IntentMode }, requestId?: string): Promise<CoreAskResult> {
    const body: { question: string; intent_mode?: IntentMode } = { question: input.question };
    if (input.intent_mode !== undefined) {
      body.intent_mode = input.intent_mode;
    }

    const requestOptions: RequestOptions = {
      method: "POST",
      body: JSON.stringify(body)
    };
    if (requestId !== undefined) {
      requestOptions.requestId = requestId;
    }

    const json = await this.requestJson("/internal/core/ask", requestOptions);

    const parsed = coreAskResultSchema.safeParse(json);
    if (!parsed.success) {
      throw new CoreClientError("Core /ask returned an unexpected response shape", "CORE_UNEXPECTED_RESPONSE");
    }

    return parsed.data;
  }

  async schemaCatalog(requestId?: string): Promise<BusinessSchemaContext> {
    const requestOptions: RequestOptions = { method: "GET" };
    if (requestId !== undefined) {
      requestOptions.requestId = requestId;
    }

    return jsonValueSchema.parse(await this.requestJson("/internal/core/schema-catalog", requestOptions));
  }

  private async requestJson(path: string, options: RequestOptions): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.requestOnce(path, options);
      } catch (error) {
        if (error instanceof CoreClientError) {
          if (!this.isRetryableCoreError(error) || attempt === 1) {
            throw error;
          }
        } else if (attempt === 1) {
          throw error;
        }

        lastError = error;
        await sleep(this.retryDelayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new CoreClientError("Core request failed", "CORE_HTTP_ERROR");
  }

  private async requestOnce(path: string, options: RequestOptions): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${this.env.CORE_SERVICE_TOKEN}`,
        accept: "application/json"
      };

      if (options.body !== undefined) {
        headers["content-type"] = "application/json";
      }

      if (options.requestId !== undefined) {
        headers["x-request-id"] = options.requestId;
      }

      const init: RequestInit = {
        method: options.method,
        headers,
        signal: controller.signal
      };

      if (options.body !== undefined) {
        init.body = options.body;
      }

      const response = await this.fetchFn(url, init);

      if (!response.ok) {
        await this.throwForCoreError(response);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof CoreClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new CoreClientError("Core request timed out", "CORE_TIMEOUT");
      }

      throw new CoreClientError("Core request failed before receiving a response", "CORE_HTTP_ERROR");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async throwForCoreError(response: Response): Promise<never> {
    const payload = await readErrorPayload(response);
    const errorCode = typeof payload === "object" && payload !== null && "code" in payload ? String(payload.code) : undefined;
    const traceId = typeof payload === "object" && payload !== null && "trace_id" in payload ? String(payload.trace_id) : undefined;

    if (response.status === 401 || errorCode === "INTERNAL_CORE_UNAUTHORIZED") {
      throw new CoreClientError("Core rejected CORE_SERVICE_TOKEN", "CORE_UNAUTHORIZED", response.status, traceId);
    }

    if (response.status === 503 || errorCode === "INTERNAL_CORE_NOT_CONFIGURED") {
      throw new CoreClientError("Core internal API is not configured", "CORE_NOT_CONFIGURED", response.status, traceId);
    }

    throw new CoreClientError(`Core request failed with HTTP ${response.status}`, "CORE_HTTP_ERROR", response.status, traceId);
  }

  private isRetryableCoreError(error: CoreClientError): boolean {
    return error.code === "CORE_TIMEOUT" || error.status === undefined || retryableStatuses.has(error.status);
  }
}

type RequestOptions = {
  method: "GET" | "POST";
  body?: string;
  requestId?: string;
};

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}
