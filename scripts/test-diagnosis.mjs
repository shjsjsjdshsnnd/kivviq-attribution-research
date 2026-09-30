/** Isolated core gate; no network, no credentials, no test-runner dependency. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(tmpdir(), "kivviq-diagnosis-"));
const localTsc = join(root, "node_modules/typescript/bin/tsc");
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...extraEnv } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? result.signal})`);
}
try {
  const args = ["-p", "tsconfig.diagnosis.json", "--outDir", out];
  if (existsSync(localTsc)) run(process.execPath, [localTsc, ...args]);
  else run("tsc", args);
  writeFileSync(join(out, "package.json"), '{"type":"module"}\n');
  run(process.execPath, ["--test", "tests/diagnosis/foundation.node-test.mjs"], { KIVVIQ_DIAGNOSIS_BUILD_URL: pathToFileURL(out + "/").href });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(out, { recursive: true, force: true });
}
