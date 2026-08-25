import { existsSync, readFileSync } from 'node:fs';

const requiredMajor = 20;
const currentMajor = Number(process.versions.node.split('.')[0]);
const requiredFiles = [
  'app/page.tsx',
  'app/layout.tsx',
  'app/globals.css',
  'public/manifest.webmanifest',
  'supabase/migrations/20260825090000_aura_mvp.sql',
];

const failures = [];
if (currentMajor < requiredMajor) {
  failures.push(`Node ${requiredMajor}+ is required; found ${process.versions.node}.`);
}
for (const file of requiredFiles) {
  if (!existsSync(file)) failures.push(`Missing required file: ${file}`);
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const installed = existsSync('node_modules/next/package.json');

console.log(`Node: ${process.versions.node}`);
console.log(`Application: ${packageJson.name}@${packageJson.version}`);
console.log(`Dependencies: ${installed ? 'installed' : 'not installed'}`);
console.log('Runtime mode: local demo (Supabase credentials are optional)');

if (!installed) {
  failures.push('Dependencies are missing. Run `npm install` before starting AURA.');
}

if (failures.length) {
  for (const failure of failures) console.error(`ERROR: ${failure}`);
  process.exitCode = 1;
} else {
  console.log('AURA is ready. Run `npm run dev`, then open http://localhost:3000.');
}
