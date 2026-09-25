// npm run release -- 1.2.0
// Builds, commits dist/ with the version bump, and tags v<version>.
// Games then install "oink-kit": "github:hieunguyen250102/oink-kit#v<version>".
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: npm run release -- <x.y.z>');
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

if (execSync('git status --porcelain').toString().trim()) {
  console.error('commit your changes first');
  process.exit(1);
}
run('npm test');
run('npm run build');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.version = version;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
run('npm install --package-lock-only --ignore-scripts');
run('git add -A package.json package-lock.json dist');
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
console.log(`\nTagged v${version}. Push with: git push && git push origin v${version}`);
