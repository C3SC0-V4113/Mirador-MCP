import { describe, expect, it } from "vitest";
import { extractBearerToken, isAuthorized, safeTokenEquals } from "../src/auth.js";

describe("auth", () => {
  it("extracts bearer tokens", () => {
    expect(extractBearerToken("Bearer secret")).toBe("secret");
    expect(extractBearerToken("bearer secret")).toBe("secret");
    expect(extractBearerToken("Basic secret")).toBeUndefined();
  });

  it("compares tokens safely", () => {
    expect(safeTokenEquals("secret", "secret")).toBe(true);
    expect(safeTokenEquals("wrong", "secret")).toBe(false);
    expect(safeTokenEquals(undefined, "secret")).toBe(false);
  });

  it("validates authorization headers", () => {
    expect(isAuthorized({ authorization: "Bearer secret" }, "secret")).toBe(true);
    expect(isAuthorized({ authorization: "Bearer wrong" }, "secret")).toBe(false);
  });
});
