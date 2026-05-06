#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyIfMissing(fromPath, toPath) {
  try {
    await fs.access(toPath);
    return false;
  } catch {
    const content = await fs.readFile(fromPath);
    await fs.writeFile(toPath, content);
    return true;
  }
}

async function upsertPackageScripts(packageJsonPath, projectRoot) {
  let pkg = {};
  try {
    pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
  } catch {
    pkg = { name: path.basename(projectRoot), version: '0.0.0', private: true };
  }

  pkg.scripts = pkg.scripts || {};
  pkg.scripts['ai:index:full'] = pkg.scripts['ai:index:full'] || 'ai-file-indexer index --full';
  pkg.scripts['ai:index:incremental'] = pkg.scripts['ai:index:incremental'] || 'ai-file-indexer index --incremental';
  pkg.scripts['ai:hooks:setup'] = pkg.scripts['ai:hooks:setup'] || 'ai-file-indexer hooks setup';

  await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');
}

export async function initProject(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, '.ai-indexer.config.json');
  const hookDir = path.join(projectRoot, '.githooks');
  const hookPath = path.join(hookDir, 'pre-commit');
  const pkgPath = path.join(projectRoot, 'package.json');

  await ensureDir(hookDir);

  const configCreated = await copyIfMissing(
    path.join(TEMPLATE_DIR, 'ai-indexer.config.json'),
    configPath
  );

  const hookCreated = await copyIfMissing(
    path.join(TEMPLATE_DIR, 'pre-commit.sh'),
    hookPath
  );

  await fs.chmod(hookPath, 0o755);
  await upsertPackageScripts(pkgPath, projectRoot);

  console.log(configCreated
    ? '[ai-init] created .ai-indexer.config.json'
    : '[ai-init] .ai-indexer.config.json already exists, skipped');

  console.log(hookCreated
    ? '[ai-init] created .githooks/pre-commit'
    : '[ai-init] .githooks/pre-commit already exists, skipped');

  console.log('[ai-init] package.json scripts ensured. run: ai-file-indexer hooks setup');
}

if (process.argv[1] === __filename) {
  initProject().catch((e) => {
    console.error(`[ai-init] failed: ${e.message}`);
    process.exit(1);
  });
}
