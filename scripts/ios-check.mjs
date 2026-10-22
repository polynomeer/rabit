// pnpm ios:check — type-checks the iOS shared package (RabitKit) with the Swift
// compiler of the Command Line Tools, for machines without Xcode. The app target and
// the tests need Xcode 26: they run in the `ios` workflow (or open apps/ios in Xcode).
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
say(dim('  The app and the tests need Xcode 26 (ios workflow in CI).'));
