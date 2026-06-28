import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isAuthorized } from "./auth.js";
import { CoreClient } from "./core-client.js";
import { parseEnv } from "./env.js";
import { runWithRequestContext } from "./request-context.js";
import { registerCoreTools, registerGuidance } from "./tools/core-tools.js";

const env = parseEnv();
const coreClient = new CoreClient(env);

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mirador-mcp",
    version: "0.1.0"
  });

  registerCoreTools(server, coreClient);
  registerGuidance(server);
  return server;
}

const httpServer = createServer((req, res) => {
  const requestId = getOrCreateRequestId(req);
  res.setHeader("x-request-id", requestId);

  void runWithRequestContext({ requestId }, async () => {
    try {
      await routeRequest(req, res);
    } catch (error) {
      console.error("Unhandled request error", { requestId, error });
      sendJson(res, 500, { error: "INTERNAL_SERVER_ERROR", request_id: requestId });
    }
  });
});

async function routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, service: "mirador-mcp" });
    return;
  }

  if (url.pathname !== "/mcp") {
    sendJson(res, 404, { error: "NOT_FOUND" });
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
    return;
  }

  if (!isAuthorized(req.headers, env.MCP_API_KEY)) {
    sendJson(res, 401, { error: "UNAUTHORIZED" });
    return;
  }

  const body = req.method === "POST" ? await readJsonBody(req) : undefined;
  const server = createMcpServer();
  const transportOptions = { sessionIdGenerator: undefined } as unknown as ConstructorParameters<
    typeof StreamableHTTPServerTransport
  >[0];
  const transport = new StreamableHTTPServerTransport(transportOptions);

  try {
    await server.connect(transport as Parameters<McpServer["connect"]>[0]);
    await transport.handleRequest(req, res, body);
  } finally {
    await transport.close();
  }
}

function getOrCreateRequestId(req: IncomingMessage): string {
  const incoming = req.headers["x-request-id"];
  const value = Array.isArray(incoming) ? incoming[0] : incoming;
  return value && value.trim().length > 0 ? value : randomUUID();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  if (res.headersSent) {
    return;
  }

  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

httpServer.listen(env.PORT, () => {
  console.log(`mirador-mcp listening on :${env.PORT}`);
});
