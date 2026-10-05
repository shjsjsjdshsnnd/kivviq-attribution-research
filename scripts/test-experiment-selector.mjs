import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
rmSync(resolve(root, '.selector-test-build'), { recursive: true, force: true })
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(['node_modules/typescript/bin/tsc', '--strict', '--noUncheckedIndexedAccess', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--rootDir', 'src', '--outDir', '.selector-test-build', 'src/experiment_selector/index.ts'])
run(['--test', 'tests/experiment_selector/core.node-test.mjs'])
