/**
 * The one place the dump filename shape lives. `backup-db.mjs` writes names
 * from `dumpName()`; `prune-backups.mjs` parses them back with `DUMP_NAME`.
 * A second copy of either is how a changed stamp format leaves the pruner
 * silently matching nothing.
 */
export function dumpStamp(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

export function dumpName(d) {
  return `murlan-${dumpStamp(d)}.sql`;
}

export const DUMP_NAME = /^murlan-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sql$/;
