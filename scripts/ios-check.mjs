// pnpm ios:check — type-checks the iOS shared package (RabitKit) with the Swift
// compiler of the Command Line Tools, for machines without Xcode, and checks the syntax
// of every other Swift file (app and tests), which catches a broken merge early. Type
// checking the app and running the tests need Xcode 26: they run in the `ios` workflow.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { ROOT, dim, fail, has, ok, run, say, step } from './lib.mjs';

if (process.platform !== 'darwin' || !has('swiftc')) {
  fail('needs macOS with the Swift compiler (xcode-select --install)');
  process.exit(1);
}
const dir = resolve(ROOT, 'apps/ios/Packages/RabitKit/Sources/RabitKit');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.swift'))
  .map((f) => resolve(dir, f));
step(`RabitKit: ${String(files.length)} sources`);
const r = run(
  'swiftc',
  ['-typecheck', '-swift-version', '6', '-target', 'arm64-apple-macosx15.0', ...files],
  { stdio: 'inherit' },
);
if (r.status !== 0) {
  fail('RabitKit does not type-check');
  process.exit(1);
}
ok('RabitKit type-checks');

/** Every .swift file under `root`, recursively. */
const swiftFiles = (root) =>
  readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.swift'))
    .map((e) => resolve(e.parentPath, e.name));
const others = [
  ...swiftFiles(resolve(ROOT, 'apps/ios/Rabit')),
  ...swiftFiles(resolve(ROOT, 'apps/ios/RabitTests')),
  ...swiftFiles(resolve(ROOT, 'apps/ios/Packages/RabitKit/Tests')),
];
step(`App and tests: ${String(others.length)} files (syntax only)`);
const p = run('swiftc', ['-parse', ...others], { stdio: 'inherit' });
if (p.status !== 0) {
  fail('a Swift file does not parse');
  process.exit(1);
}
ok('App and test sources parse');
say(dim('  Type-checking the app and running the tests need Xcode 26 (ios workflow in CI).'));
