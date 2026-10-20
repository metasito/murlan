import { test } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import { z } from "zod";
import { validate, validateQuery } from "../../server/http/validate.ts";
import { on, onSignedIn } from "../../server/http/mount.ts";
import { LoginSchema, UserSearchQuery } from "../../shared/httpSchemas.ts";
import { routeSources } from "../helpers/routeSources.ts";

const Body = z.object({ name: z.string(), age: z.number().optional() });
const limiter: RequestHandler = (_req, _res, next) => next();

// Never called: `tsc` is the check, through the mount shapes the route files use.
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
  on(app, "POST /api/auth/login", limiter, validate(LoginSchema), limiter, (req) => {
    const username: string = req.body.username;
    // @ts-expect-error a key the contract's schema does not name
    void req.body.nope;
    void username;
  });
  onSignedIn(app, "GET /api/users/search", validateQuery(UserSearchQuery, "INVALID_USERNAME"), (req, _res, userId) => {
    const username: string = req.query.username;
    void [username, userId satisfies string];
  });
  onSignedIn(app, "DELETE /api/friends/requests/:id", (req) => {
    const id: string = req.params.id;
    // @ts-expect-error a param the path does not name
    void req.params.nope;
    void id;
  });
}

test("no route file restates a schema as a cast on req.body", () => {
  for (const { file, text } of routeSources()) {
    assert.deepEqual(text.match(/req\.body as\b/g) ?? [], [], file);
  }
});

test("validateQuery answers the route's own code and hands the handler the parsed query", async () => {
  const app = express();
  app.get("/", validateQuery(UserSearchQuery, "INVALID_USERNAME"), (req, res) => {
    res.json(req.query);
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as { port: number };
  try {
    const refused = await fetch(`http://127.0.0.1:${port}/?username=`);
    assert.equal(refused.status, 400);
    assert.deepEqual(Object.keys(await refused.json()).sort(), ["code", "message", "params"]);
    const passed = await fetch(`http://127.0.0.1:${port}/?username=ana&extra=1`);
    assert.deepEqual(await passed.json(), { username: "ana" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
