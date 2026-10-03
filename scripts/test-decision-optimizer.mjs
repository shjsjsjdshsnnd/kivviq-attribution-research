import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
const output = mkdtempSync(resolve(tmpdir(), 'kivviq-optimizer-'));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}
try {
  const localCompiler = resolve('node_modules/typescript/bin/tsc');
  const sources = ['types', 'math', 'validation', 'optimizer', 'lifecycle'].map(name => `src/decision_optimizer/${name}.ts`);
  const args = ['--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--skipLibCheck', '--exactOptionalPropertyTypes', '--noFallthroughCasesInSwitch', '--noImplicitOverride', '--noPropertyAccessFromIndexSignature', '--verbatimModuleSyntax', '--rootDir', 'src', '--outDir', output, ...sources];
  if (existsSync(localCompiler)) run(process.execPath, [localCompiler, ...args]);
  else run('tsc', args);
  writeFileSync(resolve(output, 'package.json'), '{"type":"module"}\n');
  const tests = readdirSync('tests/decision_optimizer').filter(name => name.endsWith('.node-test.mjs')).sort().map(name => `tests/decision_optimizer/${name}`);
  if (!tests.length) throw new Error('No optimizer core tests discovered');
  run(process.execPath, ['--test', ...tests], { env: { ...process.env, KIVVIQ_OPTIMIZER_BUILD: output } });
} finally { rmSync(output, { recursive: true, force: true }); }
