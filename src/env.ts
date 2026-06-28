import { z } from "zod";

const envSchema = z.object({
  MCP_API_KEY: z.string().min(1, "MCP_API_KEY is required"),
  CORE_INTERNAL_URL: z.string().url("CORE_INTERNAL_URL must be a valid URL"),
  CORE_SERVICE_TOKEN: z.string().min(1, "CORE_SERVICE_TOKEN is required"),
  PORT: z.coerce.number().int().positive().default(3000)
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(input);
}
