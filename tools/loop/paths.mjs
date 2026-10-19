/** The checkout the loop runs from, and the two files the owner asks it through. */
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

export const STOP_FILE = ".loop-stop";
export const PARK_FILE = ".loop-park";

/** Whether `.loop-park` names this ticket: a request left behind cannot park the next one. */
export const parkAsked = (number, read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8")) => {
  if (number == null) return false;
  try {
    return Number(read(PARK_FILE).trim()) === number;
  } catch {
    return false;
  }
};
