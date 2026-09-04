// lib/ticketPipeline/agent.ts
import { execFileSync } from "node:child_process";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentSpec {
  /** What to send. A slash command resolves here exactly as it does interactively. */
  prompt: string;
  model: "haiku" | "sonnet" | "opus";
  effort: Effort;
  /** The worktree. Every agent in a run works in one, never in the shared checkout. */
  cwd: string;
}

export interface AgentUsage {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface AgentResult {
  ok: boolean;
  text: string;
  costUsd: number;
  turns: number;
  usage: AgentUsage;
  raw: string;
}

/**
 * What a stage cost, in tokens. Reported because the alternative is a run nobody can account for:
 * the first landed run left `total_cost_usd` and nothing else, and "was it thinking or was it
 * stuck" could not be answered from it at all.
 */
export function readUsage(json: { usage?: Record<string, number> }): AgentUsage {
  const u = json.usage ?? {};
  return {
    input: u.input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  };
}

/**
 * Every built-in tool, so a stage can reach whatever the work turns out to need — a skill it was
 * not told to use, an agent of its own, the web. A narrower list saves about 10k tokens a turn
 * and buys a stage that cannot finish; the prompt names a starting point, not a boundary.
 *
 * MCP is the one exception, and not to save the 2.6k it costs: this runs unattended, and the
 * Chrome server's tools block on a browser extension nobody is there to answer.
 *
 * Sessions are deliberately left on disk. `--no-session-persistence` saves nothing that matters
 * and costs the transcript, which is the only record of what an unattended stage actually did —
 * the first landed run could not be asked where its time went, because there was nothing to read.
 */

/** 45 minutes. Longer than any stage has ever needed; short enough that a wedged one still ends. */
export const AGENT_TIMEOUT_MS = 45 * 60_000;

/**
 * `--strict-mcp-config` with no `--mcp-config` loads no MCP server at all. Measured in this repo,
 * that alone is 13k tokens a turn — the Chrome tool schemas, which no pipeline stage can use.
 * Skills cost about 2k for all of them, so `--setting-sources` keeps everything: CLAUDE.md, the
 * project's own skills, and the `PreToolUse` guard that blocks `git add -A` and a filesystem-wide
 * `find`. The hook applies to the spawned agent because settings are what carry it.
 */
export function buildAgentArgs(spec: AgentSpec): string[] {
  // prettier-ignore
  return [
    "-p", spec.prompt,
    "--model", spec.model,
    "--effort", spec.effort,
    "--output-format", "json",
    "--strict-mcp-config",
    "--setting-sources", "user,project",
    "--permission-mode", "bypassPermissions",
  ];
}

/**
 * Nothing this returns is trusted as a fact about the repository. The runner asks git what
 * changed; the model's own account of what it did is a report, not evidence, and every stage
 * that believed one is a defect in this pipeline's history.
 */
export function runAgent(spec: AgentSpec): AgentResult {
  let raw = "";
  let ok = true;
  try {
    raw = execFileSync("claude", buildAgentArgs(spec), {
      cwd: spec.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 64 * 1024 * 1024,
      timeout: AGENT_TIMEOUT_MS,
    });
  } catch (error) {
    ok = false;
    raw = (error as { stdout?: string }).stdout ?? String((error as Error).message);
  }
  return { ok, ...parseAgentOutput(raw) };
}

const NO_USAGE: AgentUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

export function parseAgentOutput(raw: string): Omit<AgentResult, "ok"> {
  const line = raw.trim().split("\n").pop() ?? "";
  try {
    const json = JSON.parse(line);
    return {
      text: String(json.result ?? ""),
      costUsd: Number(json.total_cost_usd ?? 0),
      turns: Number(json.num_turns ?? 0),
      usage: readUsage(json),
      raw,
    };
  } catch {
    return { text: raw.slice(-2000), costUsd: 0, turns: 0, usage: NO_USAGE, raw };
  }
}
