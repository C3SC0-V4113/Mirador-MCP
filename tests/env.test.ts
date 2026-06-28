import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/env.js";

describe("env", () => {
  it("parses required variables and defaults PORT", () => {
    expect(
      parseEnv({
        MCP_API_KEY: "mcp",
        CORE_INTERNAL_URL: "http://core.internal",
        CORE_SERVICE_TOKEN: "core"
      }).PORT
    ).toBe(3000);
  });

  it("coerces PORT", () => {
    expect(
      parseEnv({
        MCP_API_KEY: "mcp",
        CORE_INTERNAL_URL: "http://core.internal",
        CORE_SERVICE_TOKEN: "core",
        PORT: "8080"
      }).PORT
    ).toBe(8080);
  });

  it("rejects invalid input", () => {
    expect(() => parseEnv({ MCP_API_KEY: "", CORE_INTERNAL_URL: "bad", CORE_SERVICE_TOKEN: "" })).toThrow();
  });
});
