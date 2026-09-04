import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const LOG_DIR = ".scratch/gate";
mkdirSync(LOG_DIR, { recursive: true });

const extra = process.argv.slice(2);
const STEPS = [
  { name: "lint", cmd: "npm run lint", secs: 150 },
  { name: "typecheck", cmd: "npm run typecheck", secs: 300 },
  { name: "devstack", cmd: "node scripts/dev-stack.mjs up", secs: 240, silentOk: true },
  { name: "unit", cmd: "npm test", secs: 900, needsDb: true },
  { name: "native", cmd: "npm run test:native", secs: 1500 },
];
if (extra.includes("--e2e")) STEPS.push({ name: "e2e", cmd: "npm run test:e2e", secs: 2100 });
if (extra.includes("--quick")) STEPS.splice(2, 3);
const onlyArg = extra.find((a) => a.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7).split(",") : null;
const steps = only ? STEPS.filter((s) => only.includes(s.name)) : STEPS;

function run(step, env) {
  return new Promise((resolve) => {
    const logPath = `${LOG_DIR}/${step.name}.log`;
    const started = Date.now();
    const child = spawn(step.cmd, {
      shell: true,
      env: { ...process.env, ...env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: true });
      } catch {}
      resolve({ code: 124, out: `${out}\n[gate] TIMEOUT after ${step.secs}s - process tree killed`, logPath, started });
    }, step.secs * 1000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, logPath, started });
    });
  });
}

let dbUrl = "";
let failures = 0;
for (const step of steps) {
  if (!extra.includes("--quick") && step.name === "devstack") {
    process.stdout.write("devstack ... ");
    const r = await run(step, {});
    writeFileSync(r.logPath, r.out);
    if (r.code !== 0) {
      failures++;
      console.log(`FAIL exit=${r.code} -> ${r.logPath}`);
      break;
    }
    const m = r.out.match(/(?:DATABASE_URL\s*=?\s*)?(postgre(?:s|sql):\/\/\S+)/i);
    dbUrl = m ? m[1].replace(/^postgres:/, "postgresql:") : "";
    console.log(dbUrl ? "PASS (url captured)" : "PASS but no DATABASE_URL found in output");
    continue;
  }
  if (step.needsDb && !dbUrl) {
    failures++;
    console.log(`FAIL ${step.name} - no DATABASE_URL captured`);
    if (!extra.includes("--keep-going")) process.exit(1);
    continue;
  }
  process.stdout.write(`${step.name} ... `);
  const r = await run(step, step.needsDb ? { DATABASE_URL: dbUrl } : {});
  writeFileSync(r.logPath, r.out);
  const secs = Math.round((Date.now() - r.started) / 1000);
  if (r.code === 0) {
    console.log(`PASS (${secs}s)`);
  } else {
    failures++;
    console.log(`FAIL exit=${r.code} (${secs}s) -> ${r.logPath}`);
    console.log(r.out.split("\n").slice(-40).join("\n"));
    if (!extra.includes("--keep-going")) process.exit(1);
  }
}
console.log(failures === 0 ? "GATE GREEN" : `GATE RED (${failures} failed)`);
process.exit(failures === 0 ? 0 : 1);

