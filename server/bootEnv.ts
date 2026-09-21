const REQUIRED_ENV = ["SESSION_SECRET", "DATABASE_URL"];
const REQUIRED_IN_PRODUCTION = ["PUBLIC_HOST"];

export function checkBootEnv(env: Record<string, string | undefined> = process.env): void {
  const production = env.NODE_ENV === "production";
  for (const key of [...REQUIRED_ENV, ...(production ? REQUIRED_IN_PRODUCTION : [])]) {
    if (!env[key]) throw new Error(`Missing required secret: ${key}`);
  }
  // pg takes TLS from the URL alone; with no sslmode it connects in plaintext
  // and a TLS-only host refuses it. `sslmode=disable` is an explicit choice.
  if (production && !new URL(env.DATABASE_URL!).searchParams.has("sslmode")) {
    throw new Error("DATABASE_URL must carry an sslmode in production (sslmode=disable to opt out)");
  }
}
