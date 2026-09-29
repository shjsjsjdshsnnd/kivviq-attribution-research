import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const runtimeIdentitySchema = z.object({ node: z.string().min(1), platform: z.string().min(1), architecture: z.string().min(1),
  v8: z.string(), icu: z.string(), locale: z.string(), timeZone: z.string() }).strict();
export function currentRuntimeIdentity() {
  return { node: process.version, platform: process.platform, architecture: process.arch,
    v8: process.versions.v8, icu: process.versions["icu"] ?? "none", locale: new Intl.Collator().resolvedOptions().locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export const executionIdentitySchema = runtimeIdentitySchema.extend({
  version: z.literal("execution-identity/1.0.0"),
  sourceSha256: hash, dependencyLockSha256: hash, compiledSha256: hash,
}).strict();
export type ExecutionIdentity = z.infer<typeof executionIdentitySchema>;
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const SOURCE_CONFIG_FILES = ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ".nvmrc"] as const;
function files(root: string, directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(join(root, directory)).sort()) {
    const path = join(directory, entry), stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw new RangeError("symlinks are not supported in a revision-pinned build");
    if (stat.isDirectory()) paths.push(...files(root, path));
    else if (stat.isFile()) paths.push(path);
    else throw new RangeError("non-regular build input");
  }
  return paths;
}
function treeDigest(root: string, paths: readonly string[]): string {
  return digest(JSON.stringify([...paths].sort().map(path => [path.replaceAll("\\", "/"), digest(readFileSync(join(root, path)))])));
}
export function captureExecutionIdentity(root = process.cwd()): ExecutionIdentity {
  const pinned = readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "");
  if (process.version !== `v${pinned}`) throw new RangeError("Node runtime does not match the pinned simulator runtime");
  const compiled = files(root, "dist").filter(path => path.endsWith(".js"));
  if (compiled.length === 0) throw new RangeError("compiled simulator is missing");
  return executionIdentitySchema.parse({ ...currentRuntimeIdentity(), version: "execution-identity/1.0.0",
    sourceSha256: treeDigest(root, [...files(root, "src"), ...SOURCE_CONFIG_FILES]),
    dependencyLockSha256: digest(readFileSync(join(root, "package-lock.json"))),
    compiledSha256: treeDigest(root, compiled),
  });
}
/** Called after a clean TypeScript build. Integrity metadata, not an author signature. */
export function stampBuild(root = process.cwd()): ExecutionIdentity {
  const identity = captureExecutionIdentity(root);
  writeFileSync(join(root, "dist", "build-identity.json"), `${JSON.stringify(identity)}\n`, { mode: 0o600 });
  return identity;
}
export function verifyExecutionIdentity(root = process.cwd()): ExecutionIdentity {
  const stamped = executionIdentitySchema.parse(JSON.parse(readFileSync(join(root, "dist", "build-identity.json"), "utf8")));
  const current = captureExecutionIdentity(root);
  if (JSON.stringify(stamped) !== JSON.stringify(current)) throw new RangeError("stale source, dependency lock, runtime or compiled simulator; rebuild before replay");
  return current;
}
export function sourcePaths(root = process.cwd()): readonly string[] {
  return [...files(root, "src"), ...SOURCE_CONFIG_FILES].map(path => relative(root, resolve(root, path)).replaceAll("\\", "/"));
}
/** CLI provenance also rejects untracked runtime inputs and staged edits. */
export function currentCodeRevision(root = process.cwd()): string {
  const options = { encoding: "utf8" as const, cwd: root };
  const head = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
  const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src", ...SOURCE_CONFIG_FILES], options).trim();
  const untracked = execFileSync("git", ["ls-files", "--others", "--", "src", ...SOURCE_CONFIG_FILES], options).trim();
  if (!/^[a-f0-9]{40}$/.test(head) || changed || untracked) throw new RangeError("commit runtime inputs before producing revision-pinned evidence");
  return head;
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== "--stamp") throw new RangeError("build stamping requires --stamp");
  stampBuild();
}
