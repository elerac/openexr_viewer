import Mocha from 'mocha';
import path from 'node:path';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true
  });
  const testsRoot = path.resolve(__dirname);
  mocha.addFile(path.resolve(testsRoot, 'extension.test.js'));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
        return;
      }
      resolve();
    });
  });
}
