#!/usr/bin/env node
/**
 * `tsc` copies TypeScript, not SVG. n8n resolves `icon: 'file:…svg'` relative
 * to the compiled node file, so the icons have to land next to it in `dist/`.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(packageRoot, 'nodes');
const target = join(packageRoot, 'dist', 'nodes');

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (entry.endsWith('.svg') || entry.endsWith('.png')) {
      const destination = join(target, relative(source, path));
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(path, destination);
      process.stdout.write(`copied ${relative(packageRoot, destination)}\n`);
    }
  }
}

walk(source);
