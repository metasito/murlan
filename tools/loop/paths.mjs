/** The checkout the loop runs from, and the two files the owner asks it through. */
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

export const STOP_FILE = ".loop-stop";
export const PARK_FILE = ".loop-park";

/**
 * Whether `.loop-park` names this ticket: a request left behind cannot park the next one. `read`
 * says whose checkout the file is read from.
 *
 * @param {number|null} number
 * @param {(file: string) => string} read
 */
export const parkAsked = (number, read) => {
  if (typeof read !== "function") throw new TypeError("parkAsked needs a reader for the checkout's .loop-park");
  if (number == null) return false;
  try {
    return Number(read(PARK_FILE).trim()) === number;
  } catch {
    return false;
  }
};
