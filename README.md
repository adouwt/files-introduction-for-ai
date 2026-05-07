# files-introduction-for-ai

用于在代码提交时自动维护项目文件索引的 npm CLI，帮助 AI 快速理解项目（避免每次全量扫代码）。

## 功能

- 支持 `全量` 与 `增量` 索引
- 集成 Git 提交钩子 `pre-commit`
- 产物双输出：
  - `.ai/file-index.json`
  - `.ai/file-index.md`
  - `.ai/module-index.md`（目录/模块聚合摘要）
  - `.ai/module-index.json`（目录/模块结构化索引）
- 接入通义千问（OpenAI 兼容接口）生成：
  - 文件功能描述
  - 方法/函数说明
- 索引失败不阻塞提交

## 支持文件类型

`js`, `ts`, `tsx`, `vue`, `py`, `java`, `go`, `md`

## 与 AI IDE 的配合（Cursor / Windsurf / Codex）

`.ai` 目录中的索引文件属于“项目上下文文件”，可被 AI IDE 当作普通文件读取与引用，但通常不会自动作为平台规则目录生效。

- 可读取：`Cursor`、`Windsurf`、`Codex` 一般都可读取 `.ai/*.md`、`.ai/*.json`
- 非规则目录：`.ai` 不是这些工具默认的规则/记忆目录
- 建议方式：在对话中显式引用，如 `@.ai/module-index.md`、`@.ai/file-index.md`
- 如需“自动规则化”生效，请将规则同步到对应工具的约定目录（如 `.cursor/`、`.windsurf/`）

## 快速开始

1. 安装（在目标项目）

```bash
npm i -D files-introduction-for-ai --registry http://npm.itodd.wang/
```

2. 初始化目标项目

```bash
npx ai-file-indexer init
```

初始化后会生成：

- `.ai-indexer.config.json`
- `.githooks/pre-commit`
- `package.json` 脚本：
  - `ai:index:full`
  - `ai:index:incremental`
  - `ai:hooks:setup`

3. 准备环境变量

支持两种 LLM 提供商：DeepSeek（优先）和通义千问。

**优先级**：先读取 `DEEPSEEK_API_KEY`，再读取 `QWEN_API_KEY`，都读取不到则走默认规则。

**方式一：环境变量**

```bash
# DeepSeek（优先）
export DEEPSEEK_API_KEY="你的DeepSeek API Key"

# 或通义千问
export QWEN_API_KEY="你的通义千问API Key"
```

**方式二：.env 文件（推荐）**

在项目根目录创建 `.env` 文件：

```
# DeepSeek（优先）
DEEPSEEK_API_KEY=你的DeepSeek API Key

# 或通义千问
QWEN_API_KEY=你的通义千问API Key
```

CLI 会自动加载项目根目录的 `.env` 文件。

4. 安装 Git hook

```bash
npm run ai:hooks:setup
```

5. 首次全量索引

```bash
npm run ai:index:full
```

6. 提交时自动增量索引

`pre-commit` 会自动执行增量索引并尝试把索引文件加入暂存区。

## CLI 命令

```bash
ai-file-indexer init
ai-file-indexer index --full
ai-file-indexer index --incremental
ai-file-indexer index --incremental --stage-output
ai-file-indexer hooks setup
```

## package.json 脚本

```bash
npm run ai:index:full
npm run ai:index:incremental
```

## 发布到 npm 私服

1. 登录私服账号

```bash
npm adduser --registry http://npm.itodd.wang/
```

2. 发布

```bash
npm publish --registry http://npm.itodd.wang/
```

## Skill 平台

```
  npx skills add adouwt/files-introduction-for-ai --yes
```

本项目已发布到 skill.sh 平台，可通过以下链接安装：

https://skills.sh/adouwt/files-introduction-for-ai

## 配置文件

见 `.ai-indexer.config.json`：

- `includeExtensions`: 可索引后缀
- `excludeGlobs`: 排除目录前缀
- `moduleMdOutput`: 模块摘要文件名
- `moduleJsonOutput`: 模块结构化索引文件名
- `llm.baseUrl`: 通义千问兼容接口地址
- `llm.model`: 默认 `qwen-plus`
- `llm.deepseek.baseUrl`: DeepSeek 接口地址（默认 `https://api.deepseek.com`）
- `llm.deepseek.model`: DeepSeek 模型（默认 `deepseek-v4-flash`）

## 注意

- 若未设置 `DEEPSEEK_API_KEY` 或 `QWEN_API_KEY`，脚本会降级为启发式摘要，不会阻塞流程。
- DeepSeek 官方文档已标注 `deepseek-chat` / `deepseek-reasoner` 后续弃用，建议使用 `deepseek-v4-flash` 或 `deepseek-v4-pro`。
- 当前方法识别基于正则，可能存在漏检/误检。
