#!/usr/bin/env node

import 'dotenv/config';
import process from 'node:process';
import { runIndexer } from '../scripts/ai-indexer.js';
import { setupHooks } from '../scripts/setup-hooks.js';
import { initProject } from '../scripts/init-project.js';

function printHelp() {
  console.log(`ai-file-indexer CLI

Usage:
  ai-file-indexer init
  ai-file-indexer index [--full|--incremental] [--stage-output]
  ai-file-indexer hooks setup
`);
}

function parseIndexArgs(args) {
  const set = new Set(args);
  return {
    mode: set.has('--full') ? 'full' : 'incremental',
    stageOutput: set.has('--stage-output')
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  const [cmd, subcmd, ...rest] = argv;

  if (cmd === 'init') {
    await initProject(process.cwd());
    return;
  }

  if (cmd === 'index') {
    const { mode, stageOutput } = parseIndexArgs([subcmd, ...rest].filter(Boolean));
    const ok = await runIndexer({ mode, stageOutput, projectRoot: process.cwd() });
    if (!ok) process.exit(1);
    return;
  }

  if (cmd === 'hooks' && subcmd === 'setup') {
    const ok = await setupHooks(process.cwd());
    if (!ok) process.exit(1);
    return;
  }

  printHelp();
  process.exit(1);
}

main().catch((e) => {
  console.error(`[ai-cli] failed: ${e.message}`);
  process.exit(1);
});
