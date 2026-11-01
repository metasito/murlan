/**
 * The supervisor's merges: arming auto-merge, disarming it, and merging now. Kept out of
 * `tracker.mjs` because `tools/loop/guard-bash.mjs` refuses to run a script that spells a merge, and
 * every session reads and files issues through the tracker's CLI.
 */
import { gh as ghCli, REPO } from "./cli.mjs";

/**
 * Auto-merge, the one write REST cannot make: arming and disarming it exist only as GraphQL
 * mutations, so these stay `gh pr merge`, and a cloud session cannot arm.
 *
 * `--merge`, never `--squash`. `--match-head-commit` sends `expectedHeadOid`, which GitHub checks
 * when it arms: a head that moved past the cleared commit is refused. It is not documented to be
 * checked again at merge time, so the caller disarms before anything can push.
 *
 * @param {string} repo @param {number} prNumber @param {string} sha @param {string} [bodyFile]
 */
export function armArgs(repo, prNumber, sha, bodyFile) {
  return ["pr", "merge", String(prNumber), "--repo", repo, "--auto", "--merge", "--match-head-commit", sha, ...(bodyFile ? ["--body-file", bodyFile] : [])];
}

/** @param {string} repo @param {number} prNumber */
export function disarmArgs(repo, prNumber) {
  return ["pr", "merge", String(prNumber), "--repo", repo, "--disable-auto"];
}

/** @param {import("./tracker.mjs").Gh} [gh] */
export function ghMerges(gh = ghCli, repo = REPO) {
  const pulls = `repos/${repo}/pulls`;
  return {
    arm: (n, sha, bodyFile, opts) => void gh(armArgs(repo, n, sha, bodyFile), opts),
    disarm: (n, opts) => void gh(disarmArgs(repo, n), opts),
    /** Merges now, refused (409) when the head is no longer `sha`: what `--match-head-commit` binds. */
    merge: (n, sha, bodyFile, opts) =>
      void gh(["api", "-X", "PUT", `${pulls}/${n}/merge`, "-f", "merge_method=merge", "-f", `sha=${sha}`, ...(bodyFile ? ["-F", `commit_message=@${bodyFile}`] : [])], opts),
  };
}
