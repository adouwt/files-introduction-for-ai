---
name: files-introduction-for-ai
description: AI code file indexer CLI with git incremental/full indexing, automatically maintains project file indexes for AI agents
---

# Files Introduction for AI

This skill provides a CLI tool that automatically maintains project file indexes during git commits, helping AI agents quickly understand codebases without needing to scan all files each time.

## Important Note

This skill describes a **npm CLI tool** that needs to be installed in target projects. Installing via `npx skills add` only registers this skill with AI agents - it does **not** automatically install the npm package or configure the project.

To actually use this tool in a project, follow the **Installation** steps below.

## When to Use

Use this skill when:
- Working with large codebases where AI agents need context about the project structure
- Want to speed up AI understanding of your codebase
- Need to maintain up-to-date file descriptions and module summaries
- Working with projects that use git and want automatic index updates on commits

## Features

- **Full & Incremental Indexing**: Supports both complete and incremental file indexing
- **Git Integration**: Automatically runs via pre-commit hooks
- **Dual Output Formats**: Generates both JSON and Markdown indexes
  - `.ai/file-index.json` - Structured file index
  - `.ai/file-index.md` - Human-readable file descriptions
  - `.ai/module-index.md` - Module/directory aggregated summaries
  - `.ai/module-index.json` - Structured module index
- **AI-Powered Descriptions**: Uses DeepSeek (priority) or Qwen (OpenAI-compatible API) to generate:
  - File function descriptions
  - Method/function explanations
- **Non-Blocking**: Indexing failures don't block git commits
- **Supported Languages**: JS, TS, TSX, Vue, Python, Java, Go, Markdown

## Installation

1. Install the package in your target project:
```bash
npm i -D files-introduction-for-ai --registry http://npm.itodd.wang/
```

2. Initialize the project:
```bash
npx ai-file-indexer init
```

This creates:
- `.ai-indexer.config.json` - Configuration file
- `.githooks/pre-commit` - Git hook script
- package.json scripts for manual indexing

3. Set up environment variables:

Supports two LLM providers: DeepSeek (priority) and Qwen.

**Priority**: `DEEPSEEK_API_KEY` → `QWEN_API_KEY` → fallback to heuristic rules.

```bash
# DeepSeek (priority)
export DEEPSEEK_API_KEY="your-deepseek-api-key"

# Or Qwen
export QWEN_API_KEY="your-qwen-api-key"
```

Or create a `.env` file in the project root:
```
# DeepSeek (priority)
DEEPSEEK_API_KEY=your-deepseek-api-key

# Or Qwen
QWEN_API_KEY=your-qwen-api-key
```

4. Install git hooks:
```bash
npm run ai:hooks:setup
```

5. Run initial full index:
```bash
npm run ai:index:full
```

## Usage

After setup, the pre-commit hook automatically runs incremental indexing when you commit changes.

**Manual commands:**
```bash
# Full indexing
npm run ai:index:full
# or
ai-file-indexer index --full

# Incremental indexing
npm run ai:index:incremental
# or
ai-file-indexer index --incremental

# Stage output files after indexing
ai-file-indexer index --incremental --stage-output
```

## Configuration

Edit `.ai-indexer.config.json` to customize:
- `includeExtensions`: File extensions to index
- `excludeGlobs`: Directory patterns to exclude
- `moduleMdOutput`: Module summary filename
- `moduleJsonOutput`: Module JSON index filename
- `llm.baseUrl`: Qwen-compatible API endpoint
- `llm.model`: Model name (default: qwen-plus)
- `llm.deepseek.baseUrl`: DeepSeek API endpoint (default: https://api.deepseek.com)
- `llm.deepseek.model`: DeepSeek model (default: deepseek-v4-flash)

## Notes

- If `DEEPSEEK_API_KEY` or `QWEN_API_KEY` is not set, the tool falls back to heuristic summarization
- DeepSeek official docs note that `deepseek-chat` / `deepseek-reasoner` will be deprecated; recommended to use `deepseek-v4-flash` or `deepseek-v4-pro`
- Method detection uses regex patterns and may have false positives/negatives
- The tool gracefully handles API failures and won't block your workflow
