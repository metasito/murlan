import pg from "pg";

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Integration tests need a real Postgres. Someone checking out the repo
 * without one must still be able to run `npm test`, so integration suites
 * should skip (via this message) rather than fail.
 */
export function skipMessage(): string {
  return "DATABASE_URL not set — skipping integration tests (unit tests still run)";
}

export interface TestServer {
  url: string;
  port: number;
  schema: string;
  stop(): Promise<void>;
}

/**
 * Schema DDL for the throwaway test schema, kept in sync by hand with
 * `shared/schema.ts`. `drizzle-kit push` has no non-interactive mode for
 * pushing to an arbitrary/ephemeral schema (it prompts for confirmation and
 * targets whatever schema is in the connection string, but offers no
 * programmatic API to drive that from a test harness), and there is no
 * migrations directory to replay (`drizzle.config.ts` has no migrations
 * committed) — so this harness creates the tables with explicit SQL instead.
 * If `shared/schema.ts` changes, this DDL must be updated to match by hand.
 */
const SCHEMA_DDL = `
  CREATE TYPE room_status AS ENUM ('waiting', 'in_progress', 'finished');
  CREATE TYPE game_mode_type AS ENUM ('free_for_all', 'teams');
  CREATE TYPE friend_status AS ENUM ('pending', 'accepted');

  CREATE TABLE users (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE,
    password text NOT NULL,
    friend_code varchar(6) NOT NULL UNIQUE,
    created_at timestamp DEFAULT now(),
    last_seen timestamp
  );

  CREATE TABLE rooms (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(6) NOT NULL UNIQUE,
    host_user_id varchar REFERENCES users(id),
    status room_status NOT NULL DEFAULT 'waiting',
    game_mode game_mode_type NOT NULL DEFAULT 'free_for_all',
    max_players integer NOT NULL DEFAULT 4,
    created_at timestamp DEFAULT now()
  );
  CREATE INDEX rooms_host_user_id_idx ON rooms (host_user_id);
  CREATE INDEX rooms_status_idx ON rooms (status);

  CREATE TABLE room_players (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id varchar NOT NULL REFERENCES rooms(id),
    user_id varchar NOT NULL REFERENCES users(id),
    seat_index integer NOT NULL,
    team varchar(1)
  );
  CREATE INDEX room_players_room_id_idx ON room_players (room_id);
  CREATE INDEX room_players_user_id_idx ON room_players (user_id);
  CREATE UNIQUE INDEX room_players_room_user_uq ON room_players (room_id, user_id);
  CREATE UNIQUE INDEX room_players_room_seat_uq ON room_players (room_id, seat_index);

  CREATE TABLE friends (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id varchar NOT NULL REFERENCES users(id),
    friend_user_id varchar NOT NULL REFERENCES users(id),
    status friend_status NOT NULL DEFAULT 'pending',
    created_at timestamp DEFAULT now()
  );
  CREATE INDEX friends_user_id_idx ON friends (user_id);
  CREATE INDEX friends_friend_user_id_idx ON friends (friend_user_id);

  CREATE TABLE active_games (
    room_code text PRIMARY KEY,
    game_state jsonb NOT NULL DEFAULT '{}',
    player_ids jsonb NOT NULL DEFAULT '[]',
    player_map jsonb NOT NULL DEFAULT '{}',
    scores jsonb NOT NULL DEFAULT '{}',
    is_public boolean NOT NULL DEFAULT false,
    max_players integer NOT NULL DEFAULT 4,
    game_mode text NOT NULL DEFAULT 'free_for_all',
    match_target integer NOT NULL DEFAULT 21,
    updated_at timestamp NOT NULL DEFAULT now()
  );

  -- connect-pg-simple, table "session", createTableIfMissing: false (see
  -- server/session.ts). The developer's real "session" table is pre-created
  -- once and deliberately never dropped/recreated by app code; the throwaway
  -- schema does not inherit it, so it must be created here too, matching
  -- connect-pg-simple's own default DDL.
  CREATE TABLE session (
    sid varchar NOT NULL COLLATE "default" PRIMARY KEY,
    sess json NOT NULL,
    expire timestamp(6) NOT NULL
  );
  CREATE INDEX "IDX_session_expire" ON session (expire);
`;

/**
 * Boots the real Express + Socket.io app against a throwaway Postgres schema
 * so tests never touch development data. The schema is created here (DDL
 * above) and dropped on stop().
 */
export async function startTestServer(): Promise<TestServer> {
  const schema = `test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const baseUrl = process.env.DATABASE_URL!;
  const admin = new pg.Pool({ connectionString: baseUrl });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  // Point every connection at the throwaway schema via search_path, and at
  // an ephemeral port, before importing the server (module scope reads
  // these — see server/db.ts, which builds its Pool at import time).
  const scopedUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}options=-c%20search_path%3D${schema}`;
  process.env.DATABASE_URL = scopedUrl;
  process.env.PORT = "0";
  process.env.SESSION_SECRET ??= "test-secret-not-for-production";

  const ddl = new pg.Pool({ connectionString: scopedUrl });
  try {
    await ddl.query(SCHEMA_DDL);
  } finally {
    await ddl.end();
  }

  // Dynamic import of testApp.ts (not index.ts): index.ts calls listen() on
  // the real PORT and installs SIGTERM/SIGINT handlers as a side effect of
  // being imported — importing it would start (and never stop) a second,
  // unwanted server. testApp.ts only builds the app and its http.Server
  // (with Socket.io already attached via server/socket.ts's setupSocket);
  // nothing binds a port until this harness explicitly listens below.
  const { createApp } = await import("../../server/testApp.ts");
  // Same module identity as whatever createApp()'s import chain (session
  // store, storage) resolved — Node's ESM cache is keyed by specifier, so
  // this is the one live `pg.Pool` the running app holds open, not a new one.
  const { pool: appPool } = await import("../../server/db.ts");
  const { server, io } = await createApp();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    schema,
    async stop() {
      io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // The app's own pool (session store + storage) is a module-level
      // singleton that nothing else closes — server/index.ts only does so in
      // its SIGTERM/SIGINT handler, which this harness never goes through.
      // Left open it both leaks a connection and keeps the test process
      // alive indefinitely.
      await appPool.end();
      const cleanup = new pg.Pool({ connectionString: baseUrl });
      await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      await cleanup.end();
      process.env.DATABASE_URL = baseUrl;
    },
  };
}
