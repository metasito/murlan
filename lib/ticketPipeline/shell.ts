/**
 * A value as one bash word.
 *
 * Every command in this package is bash, and a path from an agent arrives in
 * whichever form it happened to print. An argument that reaches a command
 * unconverted and unquoted is how the directory `murlan-wt-294;C` came to
 * exist on disk.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
