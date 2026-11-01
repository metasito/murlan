// Creates the app's own schema on DATABASE_URL, exactly as boot does, so the seed and the query
// plans run against the tables and indexes production gets.
import { createPool } from "../../../../server/store/pool.ts";
import { ensureSchema } from "../../../../server/store/schemaDdl.ts";

const pool = createPool("audit-schema", { max: 1 });
await ensureSchema(pool);
await pool.end();
