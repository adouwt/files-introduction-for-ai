---
name: files-introduction-for-ai
description: AI code file indexer CLI with git incremental/full indexing, automatically maintains project file indexes for AI agents
---

# Files Introduction for AI

This skill provides a CLI tool that automatically maintains project file indexes during git commits, helping AI agents quickly understand codebases without needing to scan all files each time.

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
- **AI-Powered Descriptions**: Uses Qwen (OpenAI-compatible API) to generate:
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
```bash
export QWEN_API_KEY="your-qwen-api-key"
```
Or create a `.env` file in the project root:
```
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

## Notes

- If `QWEN_API_KEY` is not set, the tool falls back to heuristic summarization
- Method detection uses regex patterns and may have false positives/negatives
- The tool gracefully handles API failures and won't block your workflow
