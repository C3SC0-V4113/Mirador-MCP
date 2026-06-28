import { describe, expect, it, vi } from "vitest";
import { CoreClient, CoreClientError } from "../src/core-client.js";

const env = {
  CORE_INTERNAL_URL: "http://core.internal",
  CORE_SERVICE_TOKEN: "service-token"
};

const validAskResult = {
  trace_id: "trace-1",
  answer: "MRR increased.",
  answer_source: "semantic",
  metric: "mrr",
  data: [{ month: "2026-01", value: 100 }],
  source_views: ["finance_metrics"],
  validated_sql: "select 1",
  chart_hint: { type: "line", x: "month", y: "value" },
  citations: [],
  warnings: [],
  suggested_questions: ["What changed by segment?"]
};

describe("CoreClient", () => {
  it("calls /ask with service token and request id", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, validAskResult));
    const client = new CoreClient(env, { fetchFn, retryDelayMs: 1 });

    await expect(client.ask({ question: "How did MRR change?" }, "req-1")).resolves.toEqual(validAskResult);

    expect(fetchFn).toHaveBeenCalledWith(
      new URL("http://core.internal/internal/core/ask"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer service-token",
          "x-request-id": "req-1",
          "content-type": "application/json"
        }),
        body: JSON.stringify({ question: "How did MRR change?" })
      })
    );
  });

  it("retries one retryable failure", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(500, { code: "NOPE" }))
      .mockResolvedValueOnce(jsonResponse(200, validAskResult));
    const client = new CoreClient(env, { fetchFn, retryDelayMs: 1 });

    await expect(client.ask({ question: "Revenue?" })).resolves.toEqual(validAskResult);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("maps unauthorized errors", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(401, { code: "INTERNAL_CORE_UNAUTHORIZED" }));
    const client = new CoreClient(env, { fetchFn, retryDelayMs: 1 });

    await expect(client.schemaCatalog()).rejects.toMatchObject({ code: "CORE_UNAUTHORIZED", status: 401 });
  });

  it("rejects unexpected ask shapes", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, { answer: "missing fields" }));
    const client = new CoreClient(env, { fetchFn, retryDelayMs: 1 });

    await expect(client.ask({ question: "Revenue?" })).rejects.toBeInstanceOf(CoreClientError);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
