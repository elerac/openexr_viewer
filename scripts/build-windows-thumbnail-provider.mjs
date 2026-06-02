import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = resolve(repoRoot, 'src-tauri/thumbnail-provider/Cargo.toml');
const stagingPath = resolve(repoRoot, 'src-tauri/target/thumbnail-provider/prismifold_exr_thumbnail.dll');
const cargoFlags = process.argv.slice(2);

for (const flag of cargoFlags) {
  if (flag !== '--locked') {
    throw new Error(`Unsupported argument: ${flag}`);
  }
}

const explicitTarget =
  process.env.CARGO_BUILD_TARGET ??
  process.env.TAURI_TARGET_TRIPLE ??
  process.env.TAURI_ENV_TARGET_TRIPLE ??
  process.env.TARGET ??
  process.env.PRISMIFOLD_WINDOWS_THUMBNAIL_TARGET ??
  '';
const shouldBuild =
  process.platform === 'win32' ||
  explicitTarget.includes('windows') ||
  process.env.PRISMIFOLD_BUILD_WINDOWS_THUMBNAIL_PROVIDER === '1';

if (!shouldBuild) {
  console.log('Skipping Windows EXR thumbnail provider build on this platform.');
  process.exit(0);
}

const args = ['build', ...cargoFlags, '--manifest-path', manifestPath, '--release'];
if (explicitTarget) {
  args.push('--target', explicitTarget);
}

const build = spawnSync('cargo', args, {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const builtDll = explicitTarget
  ? resolve(repoRoot, 'src-tauri/thumbnail-provider/target', explicitTarget, 'release/prismifold_exr_thumbnail.dll')
  : resolve(repoRoot, 'src-tauri/thumbnail-provider/target/release/prismifold_exr_thumbnail.dll');

if (!existsSync(builtDll)) {
  throw new Error(`Windows thumbnail provider DLL was not built: ${builtDll}`);
}

mkdirSync(dirname(stagingPath), { recursive: true });
copyFileSync(builtDll, stagingPath);
console.log(`Staged Windows EXR thumbnail provider at ${stagingPath}`);
