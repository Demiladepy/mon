import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const booleanFromEnv = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const envSchema = z.object({
  DRY_RUN: booleanFromEnv,
  DRY_RUN_WALLET_BALANCE_KOBO: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(0),
  DATABASE_PATH: z.string().default("./data/rein.db"),
  MONNIFY_BASE_URL: z.string().url().default("https://sandbox.monnify.com"),
  MONNIFY_API_KEY: z.string().default(""),
  MONNIFY_SECRET_KEY: z.string().default(""),
  MONNIFY_CONTRACT_CODE: z.string().default(""),
  MONNIFY_SOURCE_ACCOUNT: z.string().default(""),
  MONNIFY_SENDER_NAME: z.string().default("Rein Demo Business"),
  MONNIFY_SENDER_BANK_CODE: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),
  AGENT_ID: z.string().default("demo-ops-agent"),
  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(8_787),
  WEBHOOK_SECRET: z.string().default(""),
});

const env = envSchema.parse(process.env);

if (!env.DRY_RUN) {
  const missing = [
    ["MONNIFY_API_KEY", env.MONNIFY_API_KEY],
    ["MONNIFY_SECRET_KEY", env.MONNIFY_SECRET_KEY],
    ["MONNIFY_SOURCE_ACCOUNT", env.MONNIFY_SOURCE_ACCOUNT],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(
      `Missing live Monnify configuration: ${missing.map(([name]) => name).join(", ")}`,
    );
  }
}

export const config = {
  ...env,
  DATABASE_PATH:
    env.DATABASE_PATH === ":memory:"
      ? env.DATABASE_PATH
      : path.resolve(process.cwd(), env.DATABASE_PATH),
};

export type Config = typeof config;
