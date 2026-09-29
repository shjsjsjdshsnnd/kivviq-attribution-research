import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { captureExecutionIdentity, stampBuild, verifyExecutionIdentity, currentCodeRevision, SOURCE_CONFIG_FILES } from "../../src/evaluation/execution-identity.js";
import { createScheduledDecisionManifest, replayScheduledDecisionManifest } from "../../src/evaluation/decision-manifest.js";
import { createMeasuredManifest, verifyManifest, sha256 } from "../../src/evaluation/replay-manifest.js";
import { parseEvidenceArgs } from "../../src/evaluation/research-evidence-cli.js";
import { scheduledFixture } from "./fixture.js";
function tree() {
  const path = mkdtempSync(join(tmpdir(), "kivviq-build-"));
  mkdirSync(join(path, "src")); mkdirSync(join(path, "dist"));
  for (const file of SOURCE_CONFIG_FILES) writeFileSync(join(path, file), file === ".nvmrc" ? process.version.slice(1) : "{}\n");
  writeFileSync(join(path, "src", "a.ts"), "export const a=1;\n");
  writeFileSync(join(path, "dist", "a.js"), "export const a=1;\n"); return path;
}
describe("revision and executable reproducibility", () => {
  it("stamps stable fingerprints and detects changed source, lock, compiled output or runtime metadata", () => {
    const root = tree();
    try {
      expect(stampBuild(root)).toEqual(verifyExecutionIdentity(root));
      expect(captureExecutionIdentity(root)).toEqual(captureExecutionIdentity(root));
      for (const file of ["src/a.ts", "package-lock.json", "dist/a.js"]) {
        const original = readFileSync(join(root, file)); writeFileSync(join(root, file), "changed");
        expect(() => verifyExecutionIdentity(root)).toThrow("stale"); writeFileSync(join(root, file), original);
      }
      const stamp = JSON.parse(readFileSync(join(root, "dist/build-identity.json"), "utf8")); stamp.locale = "different";
      writeFileSync(join(root, "dist/build-identity.json"), JSON.stringify(stamp)); expect(() => verifyExecutionIdentity(root)).toThrow("stale");
      writeFileSync(join(root, ".nvmrc"), "0.0.0"); expect(() => captureExecutionIdentity(root)).toThrow("runtime");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("rejects symlinked source that could escape the hashed tree", () => {
    const root = tree();
    try { symlinkSync(join(root, "package.json"), join(root, "src/link.ts")); expect(() => stampBuild(root)).toThrow("symlink"); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("rejects deleted, edited or untracked runtime sources rather than citing an unchanged public revision", () => {
    const root = tree();
    const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    try {
      git(["init", "-q"]); git(["add", "src", ...SOURCE_CONFIG_FILES]);
      git(["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"]);
      expect(currentCodeRevision(root)).toMatch(/^[a-f0-9]{40}$/);
      writeFileSync(join(root, "src/new.ts"), "export {};\n"); expect(() => currentCodeRevision(root)).toThrow("commit"); rmSync(join(root, "src/new.ts"));
      rmSync(join(root, "src/a.ts")); expect(() => currentCodeRevision(root)).toThrow("commit");
      writeFileSync(join(root, "src/a.ts"), "modified"); git(["add", "src/a.ts"]); expect(() => currentCodeRevision(root)).toThrow("commit");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("reproduces a scheduled decision's full economics and rejects wrong result claims", async () => {
    const input = scheduledFixture(), revision = "a".repeat(40);
    const created = await createScheduledDecisionManifest({ input, selectedActionId: "a1", codeRevision: revision, scenarioId: "budget-control", scenarioVersion: "1" });
    const replay = await replayScheduledDecisionManifest(created.manifest, revision);
    expect(replay.result).toEqual(created.result); expect(replay.regret).toEqual(created.regret);
    expect(created.manifest.payload.choiceCommitment).toBe(sha256({ input, selectedActionId: "a1" }));
    const altered = structuredClone(created.manifest); altered.payload.result = { invented: true }; altered.payload.resultHash = sha256(altered.payload.result); altered.sha256 = sha256(altered.payload);
    await expect(replayScheduledDecisionManifest(altered, revision)).rejects.toThrow("replay mismatch");
    await expect(replayScheduledDecisionManifest(created.manifest, "b".repeat(40))).rejects.toThrow("revision");
  }, 90000);
  it("marks unbound programmatic manifests honestly and rejects runtime drift even after rehashing", () => {
    const input = scheduledFixture();
    const { manifest } = createMeasuredManifest({ scenarioId: "runtime-control", scenarioVersion: "1", codeRevision: "a".repeat(40),
      request: input.initial, options: { ...input.measurement, platformSpend: [], asOf: input.initial.endTime } });
    expect(manifest.payload.execution.mode).toBe("unbound_programmatic");
    manifest.payload.runtime.locale = "different"; manifest.sha256 = sha256(manifest.payload);
    expect(() => verifyManifest(manifest, "a".repeat(40))).toThrow("runtime");
  }, 30000);
  it("requires explicit evaluator destinations and a preselected action, without accepting truth-to-stdout flags", () => {
    expect(parseEvidenceArgs(["validate", "--out", "private.json", "--run-id", "run-1"]).mode).toBe("validate");
    expect(parseEvidenceArgs(["exact-oracle", "--out", "private.json", "--selected", "a0"]).mode).toBe("exact-oracle");
    for (const args of [[], ["validate"], ["exact-oracle", "--out", "private.json"], ["replay-exact"], ["validate", "--truth", "stdout"], ["replay-exact", "--input", "a", "--input", "b"]]) expect(() => parseEvidenceArgs(args)).toThrow();
  });
});
