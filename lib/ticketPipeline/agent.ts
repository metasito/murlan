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

export interface AgentResult {
  ok: boolean;
  text: string;
  costUsd: number;
  turns: number;
  raw: string;
}

/**
 * `Skill` and `Task` are what let a stage reach past the one skill its prompt names — a review
 * that fans out, an implementation that stops to brainstorm. Available, never required: the
 * prompt names a starting point and the agent judges the rest.
 */
const TOOLS = ["Read", "Write", "Edit", "Grep", "Glob", "Bash", "TodoWrite", "Skill", "Task"];

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
    "--tools", TOOLS.join(","),
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
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

export function parseAgentOutput(raw: string): Omit<AgentResult, "ok"> {
  const line = raw.trim().split("\n").pop() ?? "";
  try {
    const json = JSON.parse(line);
    return {
      text: String(json.result ?? ""),
      costUsd: Number(json.total_cost_usd ?? 0),
      turns: Number(json.num_turns ?? 0),
      raw,
    };
  } catch {
    return { text: raw.slice(-2000), costUsd: 0, turns: 0, raw };
  }
}
