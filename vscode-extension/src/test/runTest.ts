import path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  sanitizeInheritedElectronEnvironment();

  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(extensionDevelopmentPath, 'out', 'test', 'suite', 'index');

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function sanitizeInheritedElectronEnvironment(): void {
  delete process.env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_')) {
      delete process.env[key];
    }
  }
}
