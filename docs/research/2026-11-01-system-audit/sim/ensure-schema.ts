// Creates the app's own schema on DATABASE_URL, exactly as boot does, so the seed and the query
// plans run against the tables and indexes production gets.
import { ensureSchema } from "../../../../server/store/schemaDdl.ts";

await ensureSchema();
