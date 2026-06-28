import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CoreAskResult, CoreClient, IntentMode, JsonObject, JsonValue } from "../core-client.js";
import { CoreClientError } from "../core-client.js";
import { getRequestId } from "../request-context.js";

const questionSchema = z.object({
  question: z.string().min(1).describe("Business question to answer using governed company data."),
  intent_mode: z.enum(["responder", "analizar", "reporte_visual", "plan"]).optional()
});

const schemaInput = z.object({});

export function registerCoreTools(server: McpServer, coreClient: CoreClient): void {
  server.registerTool(
    "ask_company_data",
    {
      title: "Ask company data",
      description: "Answer an executive business question through Mirador Core's governed data pipeline.",
      inputSchema: questionSchema.shape
    },
    async ({ question, intent_mode }) => {
      const result = await callAsk(coreClient, question, intent_mode);
      return toolResult(result.answer, result);
    }
  );

  server.registerTool(
    "describe_business_schema",
    {
      title: "Describe business schema",
      description: "Return the governed business schema catalog available to Mirador Core.",
      inputSchema: schemaInput.shape
    },
    async () => {
      try {
        const catalog = await coreClient.schemaCatalog(getRequestId());
        return toolResult("Governed business schema catalog returned by Mirador Core.", { catalog });
      } catch (error) {
        throw toToolError(error);
      }
    }
  );

  server.registerTool(
    "run_readonly_query",
    {
      title: "Run readonly query",
      description: "Ask Mirador Core to produce a governed readonly SQL answer and return validated SQL plus rows.",
      inputSchema: questionSchema.shape
    },
    async ({ question, intent_mode }) => {
      const result = await callAsk(coreClient, question, intent_mode ?? "analizar");
      return toolResult(result.answer, pick(result, ["trace_id", "validated_sql", "data", "source_views", "warnings"]));
    }
  );

  server.registerTool(
    "generate_chart_spec",
    {
      title: "Generate chart spec",
      description: "Ask Mirador Core for chart-ready governed data and chart hints for an executive visualization.",
      inputSchema: questionSchema.shape
    },
    async ({ question, intent_mode }) => {
      const result = await callAsk(coreClient, question, intent_mode ?? "reporte_visual");
      return toolResult(result.answer, pick(result, ["trace_id", "chart_hint", "data", "metric", "warnings"]));
    }
  );

  server.registerTool(
    "search_company_knowledge",
    {
      title: "Search company knowledge",
      description: "Search governed company knowledge and return the narrative answer with document citations.",
      inputSchema: questionSchema.shape
    },
    async ({ question, intent_mode }) => {
      const result = await callAsk(coreClient, question, intent_mode ?? "responder");
      return toolResult(result.answer, pick(result, ["trace_id", "answer", "answer_source", "citations", "warnings"]));
    }
  );

  server.registerTool(
    "suggest_executive_questions",
    {
      title: "Suggest executive questions",
      description: "Suggest useful follow-up questions for executive analysis based on the current business question.",
      inputSchema: questionSchema.shape
    },
    async ({ question, intent_mode }) => {
      const result = await callAsk(coreClient, question, intent_mode ?? "plan");
      return toolResult("Suggested executive questions returned by Mirador Core.", pick(result, ["trace_id", "suggested_questions", "warnings"]));
    }
  );
}

export function registerGuidance(server: McpServer): void {
  server.registerPrompt(
    "mirador_executive_analysis",
    {
      title: "Mirador executive analysis",
      description: "Guide clients to ask focused executive questions against governed Mirador company data.",
      argsSchema: {
        topic: z.string().optional().describe("Optional business topic such as MRR, churn, projects, cash flow, or documents.")
      }
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use Mirador MCP tools for governed executive analysis${topic ? ` about ${topic}` : ""}. Prefer ask_company_data for broad questions, run_readonly_query for tabular/SQL-backed analysis, generate_chart_spec for visualization-ready answers, search_company_knowledge for cited document answers, and suggest_executive_questions for follow-ups. Always preserve trace_id when reporting results.`
          }
        }
      ]
    })
  );
}

async function callAsk(coreClient: CoreClient, question: string, intentMode: IntentMode | undefined): Promise<CoreAskResult> {
  try {
    const input: { question: string; intent_mode?: IntentMode } = { question };
    if (intentMode !== undefined) {
      input.intent_mode = intentMode;
    }
    return await coreClient.ask(input, getRequestId());
  } catch (error) {
    throw toToolError(error);
  }
}

function toolResult(text: string, structuredContent: JsonObject) {
  return {
    content: [
      { type: "text" as const, text },
      { type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }
    ],
    structuredContent
  };
}

function pick<T extends CoreAskResult, K extends keyof T>(value: T, keys: K[]): JsonObject {
  const output: JsonObject = {};
  for (const key of keys) {
    output[String(key)] = value[key] as JsonValue;
  }
  return output;
}

function toToolError(error: unknown): Error {
  if (error instanceof CoreClientError) {
    return new Error(`${error.code}: ${error.message}${error.traceId ? ` (trace_id=${error.traceId})` : ""}`);
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error("Unknown Mirador Core error");
}
