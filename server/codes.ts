import { randomInt } from "node:crypto";

// No O/0/I/1 — one alphabet for room codes and friend codes both, so a code
// read aloud or typed from a screenshot is unambiguous whichever kind it is.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}
