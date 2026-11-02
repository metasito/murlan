import { logger } from "../shared/logger.ts";

const REQUIRED_ENV = ["SESSION_SECRET", "DATABASE_URL", "REDIS_URL"];
const REQUIRED_IN_PRODUCTION = ["PUBLIC_HOST"];

export function checkBootEnv(
  env: Record<string, string | undefined> = process.env,
  warnUrlNamesSessions: () => void = () =>
    logger.warn(
      "The database URL sets application_name, which replaces every pool's murlan-<use> name: " +
        "the connection budget can no longer count instances, and pg_stat_activity names no use"
    )
): void {
  const production = env.NODE_ENV === "production";
  for (const key of [...REQUIRED_ENV, ...(production ? REQUIRED_IN_PRODUCTION : [])]) {
    if (!env[key]) throw new Error(`Missing required secret: ${key}`);
  }
  if (!production) return;
  const params = new URL(env.DATABASE_URL!).searchParams;
  // pg takes TLS from the URL alone; with no sslmode it connects in plaintext
  // and a TLS-only host refuses it. `sslmode=disable` is an explicit choice.
  if (!params.has("sslmode")) {
    throw new Error("DATABASE_URL must carry an sslmode in production (sslmode=disable to opt out)");
  }
  if (params.has("application_name")) warnUrlNamesSessions();
}
