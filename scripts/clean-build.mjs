import fs from 'fs';
import path from 'path';

const root = process.cwd();
const targets = [
  '.next',
  'tsconfig.tsbuildinfo',
  path.join('worker-dist', 'tsconfig.worker.tsbuildinfo'),
];

for (const target of targets) {
  const full = path.join(root, target);
  try {
    fs.rmSync(full, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[clean-build] Could not remove ${target}:`, err?.message || err);
  }
}
