import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express, { type RequestHandler } from "express";
import { z } from "zod";
import { validate } from "../../server/http/validate.ts";

const Body = z.object({ name: z.string(), age: z.number().optional() });
const limiter: RequestHandler = (_req, _res, next) => next();

// Never called: `tsc` is the check, through the mount shapes routes.ts uses.
export function mounts(app: express.Express) {
  app.post("/before", limiter, validate(Body), limiter, (req) => {
    const name: string = req.body.name;
    const age: number | undefined = req.body.age;
    // @ts-expect-error a key the schema does not name
    void req.body.nope;
    void [name, age];
  });
  app.post("/alone", validate(Body), (req) => {
    // @ts-expect-error `age` is optional in the schema
    const age: number = req.body.age;
    void age;
  });
}

test("routes.ts restates no schema as a cast on req.body", () => {
  const routes = readFileSync(new URL("../../server/http/routes.ts", import.meta.url), "utf8");
  assert.deepEqual(routes.match(/req\.body as\b/g) ?? [], []);
});
