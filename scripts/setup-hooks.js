#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function runGit(args, gitCwd = process.cwd()) {
  const r = spawnSync('git', args, { encoding: 'utf-8', cwd: gitCwd });
  if (r.status !== 0) {
    const msg = (r.stderr || '').trim() || `git ${args.join(' ')} failed`;
    throw new Error(msg);
  }
  return (r.stdout || '').trim();
}

export async function setupHooks(projectRoot = process.cwd()) {
  try {
    runGit(['rev-parse', '--is-inside-work-tree'], projectRoot);
  } catch {
    console.error('[ai-hooks] current directory is not a git repository.');
    return false;
  }

  const hookFile = path.join(projectRoot, '.githooks', 'pre-commit');
  try {
    await fs.access(hookFile);
  } catch {
    console.error('[ai-hooks] missing .githooks/pre-commit');
    return false;
  }

  await fs.chmod(hookFile, 0o755);
  runGit(['config', 'core.hooksPath', '.githooks'], projectRoot);

  console.log('[ai-hooks] setup complete. git will use .githooks/pre-commit');
  return true;
}

async function main() {
  const ok = await setupHooks(process.cwd());
  if (!ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error(`[ai-hooks] setup failed: ${e.message}`);
    process.exit(1);
  });
}
