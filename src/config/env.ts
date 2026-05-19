import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(12).default("dev-access-secret-change-me"),
  REFRESH_TOKEN_SECRET: z.string().min(12).default("dev-refresh-secret-change-me"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  N8N_WEBHOOK_URL: z.string().url().optional(),
  N8N_TRUSTED_HEADER_VALUE: z.string().default("yes"),
  N8N_BINARY_FIELD_NAME: z.string().min(1).default("data"),
  N8N_CALLBACK_URL: z.string().url().optional(),
  RUN_ANALYSIS_INLINE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}
