#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_CONFIG_FILE = '.ai-indexer.config.json';
const PACKAGE_SKILL_DIR_NAME = 'files-introduction-for-ai';
const PACKAGE_SKILL_FILE_NAME = 'SKILL.md';
const LLM_CONCURRENCY = 3;

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  const full = args.has('--full');
  const incremental = args.has('--incremental') || !full;
  const stageOutput = args.has('--stage-output');
  return { mode: full ? 'full' : 'incremental', incremental, stageOutput };
}

function runGit(args, gitCwd = process.cwd()) {
  const r = spawnSync('git', args, { encoding: 'utf-8', cwd: gitCwd });
  if (r.status !== 0) {
    const err = (r.stderr || '').trim() || `git ${args.join(' ')} failed`;
    throw new Error(err);
  }
  return (r.stdout || '').trim();
}

function isExcluded(filePath, excludeGlobs) {
  const normalized = filePath.replace(/\\/g, '/');
  return excludeGlobs.some((g) => normalized.startsWith(g));
}

function getLanguage(filePath) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  const map = {
    js: 'JavaScript',
    ts: 'TypeScript',
    tsx: 'TSX',
    vue: 'Vue',
    py: 'Python',
    java: 'Java',
    go: 'Go',
    md: 'Markdown'
  };
  return map[ext] || 'Text';
}

function extractFunctions(content, filePath) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  const funcs = new Set();

  if (['js', 'ts', 'tsx', 'vue'].includes(ext)) {
    const patterns = [
      /function\s+([a-zA-Z_$][\w$]*)\s*\(/g,
      /const\s+([a-zA-Z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>/g,
      /export\s+function\s+([a-zA-Z_$][\w$]*)\s*\(/g,
      /([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/g
    ];
    for (const p of patterns) {
      let m;
      while ((m = p.exec(content))) funcs.add(m[1]);
    }
  } else if (ext === 'py') {
    const p = /^def\s+([a-zA-Z_][\w]*)\s*\(/gm;
    let m;
    while ((m = p.exec(content))) funcs.add(m[1]);
  } else if (ext === 'java') {
    const p = /(public|protected|private)?\s*(static\s+)?[\w<>\[\]]+\s+([a-zA-Z_][\w]*)\s*\([^)]*\)\s*\{/g;
    let m;
    while ((m = p.exec(content))) funcs.add(m[3]);
  } else if (ext === 'go') {
    const p = /func\s+(\([^)]+\)\s+)?([A-Za-z_][\w]*)\s*\(/g;
    let m;
    while ((m = p.exec(content))) funcs.add(m[2]);
  }

  return Array.from(funcs).slice(0, 100);
}

function extractDependencies(content, filePath) {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  const deps = new Set();

  if (['js', 'ts', 'tsx', 'vue'].includes(ext)) {
    const importPattern = /import\s+.+?from\s+['\"]([^'\"]+)['\"]/g;
    const requirePattern = /require\(['\"]([^'\"]+)['\"]\)/g;
    let m;
    while ((m = importPattern.exec(content))) deps.add(m[1]);
    while ((m = requirePattern.exec(content))) deps.add(m[1]);
  } else if (ext === 'py') {
    const importPattern = /^import\s+([\w.]+)/gm;
    const fromPattern = /^from\s+([\w.]+)\s+import\s+/gm;
    let m;
    while ((m = importPattern.exec(content))) deps.add(m[1]);
    while ((m = fromPattern.exec(content))) deps.add(m[1]);
  } else if (ext === 'go') {
    const importBlock = /import\s*\(([^)]+)\)/g;
    const importSingle = /import\s+"([^"]+)"/g;
    let m;
    while ((m = importSingle.exec(content))) deps.add(m[1]);
    while ((m = importBlock.exec(content))) {
      const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean);
      for (const l of lines) {
        const mm = l.match(/"([^"]+)"/);
        if (mm) deps.add(mm[1]);
      }
    }
  } else if (ext === 'java') {
    const importPattern = /^import\s+([\w.*]+);/gm;
    let m;
    while ((m = importPattern.exec(content))) deps.add(m[1]);
  }

  return Array.from(deps).slice(0, 50);
}

async function callLlmSummarize({ provider, apiKey, baseUrl, model, filePath, language, content, functions, dependencies }) {
  if (!apiKey) {
    return {
      summary: `File ${filePath} in ${language}. Heuristic summary generated without LLM API key.`,
      purpose: 'No API key provided, fallback summary used.',
      methodNotes: functions.map((f) => `${f}: function signature extracted by regex.`)
    };
  }

  const prompt = [
    '你是代码索引助手。请为给定文件生成结构化摘要。',
    '输出必须是合法 JSON，字段必须包含：summary, purpose, methodNotes。',
    '要求：',
    '- summary：1-3句，描述文件整体职责',
    '- purpose：一句话描述业务功能',
    '- methodNotes：数组。按函数名给出简短说明（每项 <= 40字）',
    `文件路径: ${filePath}`,
    `语言: ${language}`,
    `候选函数: ${functions.join(', ') || '无'}`,
    `候选依赖: ${dependencies.join(', ') || '无'}`,
    '文件内容如下：',
    content
  ].join('\n');

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: '你是严谨的软件代码分析助手。' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${provider} API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  const contentText = data?.choices?.[0]?.message?.content?.trim() || '';
  const jsonText = contentText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const parsed = JSON.parse(jsonText);
  return {
    summary: parsed.summary || '',
    purpose: parsed.purpose || '',
    methodNotes: Array.isArray(parsed.methodNotes) ? parsed.methodNotes : []
  };
}

function toMd(index) {
  const lines = [];
  lines.push('# AI File Index');
  lines.push('');
  lines.push(`- Generated At: ${index.generatedAt}`);
  lines.push(`- Mode: ${index.mode}`);
  lines.push(`- File Count: ${index.files.length}`);
  lines.push('');

  for (const f of index.files) {
    lines.push(`## ${f.path}`);
    lines.push(`- Language: ${f.language}`);
    lines.push(`- Purpose: ${f.purpose || 'N/A'}`);
    lines.push(`- Summary: ${f.summary || 'N/A'}`);
    lines.push(`- Dependencies: ${f.dependencies.join(', ') || 'N/A'}`);
    lines.push(`- Functions: ${f.functions.join(', ') || 'N/A'}`);
    if (f.methodNotes?.length) {
      lines.push('- Method Notes:');
      for (const n of f.methodNotes) lines.push(`  - ${n}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getExistingIdeDirs(projectRoot) {
  const ideDirs = ['.windsurf', '.cursor', '.vscode', '.codex', '.cloudcode'];
  const existingIdeDirs = [];

  for (const ideDir of ideDirs) {
    const idePath = path.join(projectRoot, ideDir);
    if (await fileExists(idePath)) {
      existingIdeDirs.push(idePath);
    }
  }

  return existingIdeDirs;
}

async function writeIdeSkills(projectRoot, ideDirs, skillContent) {
  for (const idePath of ideDirs) {
    const skillsDir = path.join(idePath, 'skills', PACKAGE_SKILL_DIR_NAME);
    const targetSkillPath = path.join(skillsDir, PACKAGE_SKILL_FILE_NAME);

    try {
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(targetSkillPath, skillContent, 'utf-8');
      console.log(`[ai-index] created ${path.relative(projectRoot, targetSkillPath)}`);
    } catch (e) {
      console.warn(`[ai-index] write IDE skill failed (${path.relative(projectRoot, targetSkillPath)}): ${e.message}`);
    }
  }
}

function buildModuleIndex(index) {
  const moduleMap = new Map();

  for (const f of index.files) {
    const dir = path.dirname(f.path);
    const moduleKey = dir === '.' ? '(root)' : dir;
    if (!moduleMap.has(moduleKey)) {
      moduleMap.set(moduleKey, {
        files: [],
        purposes: new Set(),
        summaries: new Set(),
        functionCount: 0,
        dependencyCount: 0
      });
    }

    const m = moduleMap.get(moduleKey);
    m.files.push(f.path);
    if (f.purpose) m.purposes.add(f.purpose);
    if (f.summary) m.summaries.add(f.summary);
    m.functionCount += Array.isArray(f.functions) ? f.functions.length : 0;
    m.dependencyCount += Array.isArray(f.dependencies) ? f.dependencies.length : 0;
  }

  const modules = Array.from(moduleMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([moduleName, m]) => ({
      module: moduleName,
      fileCount: m.files.length,
      functionCount: m.functionCount,
      dependencyCount: m.dependencyCount,
      purposes: Array.from(m.purposes),
      summaries: Array.from(m.summaries),
      files: m.files.sort((a, b) => a.localeCompare(b))
    }));

  return {
    generatedAt: index.generatedAt,
    mode: index.mode,
    moduleCount: modules.length,
    modules
  };
}

function toModuleMd(moduleIndex) {
  const lines = [];
  lines.push('# AI Module Index');
  lines.push('');
  lines.push(`- Generated At: ${moduleIndex.generatedAt}`);
  lines.push(`- Mode: ${moduleIndex.mode}`);
  lines.push(`- Module Count: ${moduleIndex.moduleCount}`);
  lines.push('');

  for (const m of moduleIndex.modules) {
    const topPurposes = m.purposes.slice(0, 3);
    const topSummaries = m.summaries.slice(0, 2);

    lines.push(`## ${m.module}`);
    lines.push(`- Files: ${m.fileCount}`);
    lines.push(`- Functions (estimated): ${m.functionCount}`);
    lines.push(`- Dependencies (estimated): ${m.dependencyCount}`);
    lines.push(`- Purpose: ${topPurposes.join(' / ') || 'N/A'}`);
    lines.push(`- Summary: ${topSummaries.join(' / ') || 'N/A'}`);
    lines.push('- File List:');
    for (const file of m.files) {
      lines.push(`  - ${file}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

async function getTargetFiles(config, mode, projectRoot) {
  const all = mode === 'full'
    ? runGit(['ls-files'], projectRoot).split('\n').filter(Boolean)
    : runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], projectRoot).split('\n').filter(Boolean);

  return all.filter((f) => {
    const ext = path.extname(f).replace('.', '').toLowerCase();
    if (!config.includeExtensions.includes(ext)) return false;
    if (isExcluded(f, config.excludeGlobs)) return false;
    return true;
  });
}

async function stageOutputs(outputDir, jsonOutput, mdOutput, moduleMdOutput, moduleJsonOutput, projectRoot) {
  try {
    runGit(['add', path.join(outputDir, jsonOutput)], projectRoot);
    runGit(['add', path.join(outputDir, mdOutput)], projectRoot);
    runGit(['add', path.join(outputDir, moduleMdOutput)], projectRoot);
    runGit(['add', path.join(outputDir, moduleJsonOutput)], projectRoot);
  } catch (e) {
    console.warn(`[ai-index] stage output failed: ${e.message}`);
  }
}

async function processFile(file, projectRoot, config, provider, apiKey, baseUrl, model) {
  const abs = path.join(projectRoot, file);
  let content = '';
  try {
    content = await fs.readFile(abs, 'utf-8');
  } catch {
    return null;
  }

  const language = getLanguage(file);
  const functions = extractFunctions(content, file);
  const dependencies = extractDependencies(content, file);
  const truncated = content.slice(0, config.maxFileCharsForLlm || 8000);

  let llm = {
    summary: `File ${file} (${language}).`,
    purpose: 'Auto-generated fallback purpose.',
    methodNotes: functions.map((f) => `${f}: extracted method`)
  };

  try {
    console.log(`[ai-index] summarizing ${file} with ${provider}`);
    llm = await callLlmSummarize({
      provider,
      apiKey,
      baseUrl,
      model,
      filePath: file,
      language,
      content: truncated,
      functions,
      dependencies
    });
  } catch (e) {
    console.warn(`[ai-index] ${provider} summarize failed for ${file}: ${e.message}`);
  }

  return {
    path: file,
    language,
    summary: llm.summary,
    purpose: llm.purpose,
    functions,
    methodNotes: llm.methodNotes,
    dependencies
  };
}

export async function runIndexer({ mode = 'incremental', stageOutput = false, projectRoot = process.cwd() } = {}) {
  const configPath = path.join(projectRoot, DEFAULT_CONFIG_FILE);

  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  } catch (e) {
    console.error(`[ai-index] load config failed: ${e.message}`);
    return false;
  }

  let files = [];
  try {
    files = await getTargetFiles(config, mode, projectRoot);
  } catch (e) {
    console.error(`[ai-index] discover files failed: ${e.message}`);
    return false;
  }

  if (!files.length) {
    console.log(`[ai-index] no eligible files for ${mode}.`);
    return true;
  }

  const ideDirs = await getExistingIdeDirs(projectRoot);
  const hasIde = ideDirs.length > 0;

  const deepseekApiKey = process.env.DEEPSEEK_API_KEY || '';
  const qwenApiKey = process.env.QWEN_API_KEY || '';
  
  let provider, apiKey, baseUrl, model;
  
  if (deepseekApiKey) {
    provider = 'deepseek';
    apiKey = deepseekApiKey;
    baseUrl = config.llm.deepseek?.baseUrl || 'https://api.deepseek.com';
    model = config.llm.deepseek?.model || 'deepseek-v4-flash';
  } else if (qwenApiKey) {
    provider = 'qwen';
    apiKey = qwenApiKey;
    baseUrl = config.llm.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    model = config.llm.model || 'qwen-plus';
  } else {
    provider = 'fallback';
    apiKey = '';
    baseUrl = '';
    model = '';
  }

  const results = [];
  const total = files.length;
  let completed = 0;

  for (let i = 0; i < files.length; i += LLM_CONCURRENCY) {
    const batch = files.slice(i, i + LLM_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((file) => processFile(file, projectRoot, config, provider, apiKey, baseUrl, model))
    );

    for (const r of batchResults) {
      if (r) results.push(r);
    }

    completed += batch.length;
    console.log(`[ai-index] progress: ${Math.min(completed, total)}/${total} files processed`);
  }

  const index = {
    generatedAt: new Date().toISOString(),
    mode,
    provider,
    model,
    files: results
  };

  const moduleMdOutput = config.moduleMdOutput || 'module-index.md';
  const moduleJsonOutput = config.moduleJsonOutput || 'module-index.json';
  const moduleIndex = buildModuleIndex(index);
  const moduleMdContent = toModuleMd(moduleIndex);

  if (hasIde) {
    await writeIdeSkills(projectRoot, ideDirs, moduleMdContent);
    console.log('[ai-index] IDE directory detected, skill updated with module index and skip .ai output generation.');
    if (stageOutput) {
      console.log('[ai-index] skip .ai output staging because IDE directory is present.');
    }
    return true;
  }

  const outDir = path.join(projectRoot, config.outputDir);
  await fs.mkdir(outDir, { recursive: true });

  const jsonPath = path.join(outDir, config.jsonOutput);
  const mdPath = path.join(outDir, config.mdOutput);
  const moduleMdPath = path.join(outDir, moduleMdOutput);
  const moduleJsonPath = path.join(outDir, moduleJsonOutput);

  await fs.writeFile(jsonPath, `${JSON.stringify(index, null, 2)}\n`, 'utf-8');
  await fs.writeFile(mdPath, toMd(index), 'utf-8');
  await fs.writeFile(moduleMdPath, moduleMdContent, 'utf-8');
  await fs.writeFile(moduleJsonPath, `${JSON.stringify(moduleIndex, null, 2)}\n`, 'utf-8');

  if (stageOutput) {
    await stageOutputs(config.outputDir, config.jsonOutput, config.mdOutput, moduleMdOutput, moduleJsonOutput, projectRoot);
  }

  console.log(`[ai-index] done. generated ${results.length} file entries in ${mode} mode.`);
  return true;
}

async function main() {
  const { mode, stageOutput } = parseArgs(process.argv);
  await runIndexer({ mode, stageOutput, projectRoot: process.cwd() });
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error(`[ai-index] unexpected error: ${e.message}`);
    process.exit(0);
  });
}
