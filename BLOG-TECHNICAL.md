# 技术视角：我是如何把“给 AI 用的代码索引器”做成可复用 npm CLI 的

在 AI 辅助开发成为常态的今天，一个持续出现的工程问题是：**AI 缺少项目上下文**。  
我为此做了一个工具：`files-introduction-for-ai`，并把它改造成可发布的 npm CLI —— `ai-file-indexer`。

这篇文章会从技术实现的角度，讲清楚它的设计取舍、核心流程和工程细节。

---

## 问题定义：为什么需要“代码索引器”？

很多团队都遇到过这些问题：

- 代码库较大，AI 只能“盲猜”业务结构
- 每次让 AI 介入都要重复解释模块关系
- 变更后没有增量更新，索引很快过期
- 提交代码时缺少“上下文产物”的自动更新机制

目标很明确：**把“给 AI 解释项目”从一次性对话，变成可持续、可自动化的工程资产**。

---

## 整体架构设计

这个 CLI 的核心职责可以拆成三块：

1. **初始化**：生成配置和 hooks 模板，补齐 `package.json` scripts
2. **索引**：扫描文件、提取结构、调用 LLM、生成索引产物
3. **Git 集成**：设置 hooks 路径，让提交自动触发索引更新

命令入口设计为：

- `ai-file-indexer init`
- `ai-file-indexer index --full|--incremental [--stage-output]`
- `ai-file-indexer hooks setup`

---

## 核心流程详解

### 1) 初始化阶段（`init`）

初始化的目标是：**把接入成本降到最低**。

执行逻辑：

- 从 `templates/` 目录复制配置模板到目标项目根目录：
  - `.ai-indexer.config.json`（索引配置）
  - `.githooks/pre-commit`（提交前触发索引的脚本）
- 确保 `.githooks/pre-commit` 可执行（`chmod 0o755`）
- 读取 `package.json`，若不存在则创建一个最小骨架
- 在 `package.json.scripts` 中补齐以下命令（若已存在则跳过）：
  - `ai:index:full`：全量索引
  - `ai:index:incremental`：增量索引
  - `ai:hooks:setup`：设置 Git hooks 路径

设计取舍：

- 配置文件和 hooks 模板采用“若不存在则复制”的策略，避免覆盖用户自定义
- `package.json` scripts 采用“upsert”而非“覆盖”，保证不破坏已有脚本

---

### 2) 索引阶段（`index`）

索引是整个工具的核心，流程较长，这里拆开讲。

#### 2.1 配置加载与参数解析

- 从项目根目录读取 `.ai-indexer.config.json`
- 解析命令行参数：
  - `--full`：全量模式
  - `--incremental`：增量模式（默认）
  - `--stage-output`：将索引产物自动加入暂存区

#### 2.2 目标文件发现

根据模式选择文件来源：

- **全量模式**：调用 `git ls-files`，获取所有被 git 跟踪的文件
- **增量模式**：调用 `git diff --cached --name-only --diff-filter=ACMR`，获取当前 staged 的变更文件

过滤逻辑：

- 检查文件扩展名是否在 `includeExtensions` 白名单中
- 检查文件路径是否匹配 `excludeGlobs` 中的任意排除规则（如 `node_modules/`、`dist/`）

设计取舍：

- 使用 `git ls-files` 而非文件系统遍历，避免扫描到未被跟踪的临时文件
- 增量模式只处理 staged 文件，保证“提交即更新”的语义一致性

#### 2.3 文件结构提取

对每个目标文件，提取以下信息：

- **语言类型**：根据扩展名映射（支持 JS/TS/TSX/Vue/Python/Java/Go/Markdown）
- **函数名**：使用正则表达式抽取（不同语言有不同的模式）
  - JS/TS：`function\s+([a-zA-Z_$][\w$]*)\s*\(`、`const\s+([a-zA-Z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>` 等
  - Python：`^def\s+([a-zA-Z_][\w]*)\s*\(`
  - Java：`(public|protected|private)?\s*(static\s+)?[\w<>\[\]]+\s+([a-zA-Z_][\w]*)\s*\([^)]*\)\s*\{`
  - Go：`func\s+(\([^)]+\)\s+)?([A-Za-z_][\w]*)\s*\(`
- **依赖信息**：同样使用正则抽取
  - JS/TS：`import\s+.+?from\s+['\"]([^'\"]+)['\"]`、`require\(['\"]([^'\"]+)['\"]\)`
  - Python：`^import\s+([\w.]+)`、`^from\s+([\w.]+)\s+import\s+`
  - Go：`import\s+"([^"]+)"`、`import\s*\(([^)]+)\)`
  - Java：`^import\s+([\w.*]+);`

设计取舍：

- 使用正则而非 AST 解析，原因：
  - 轻量、无额外依赖
  - 不需要完整语法树，只需要函数名和依赖名
  - 对多语言支持更灵活（每种语言写一套正则即可）
- 限制抽取数量（函数最多 100 个，依赖最多 50 个），避免极端文件导致内存问题

#### 2.4 LLM 摘要生成

调用大模型生成结构化摘要：

- 从环境变量读取 `QWEN_API_KEY`（若未设置则走兜底逻辑）
- 截取文件内容前 `maxFileCharsForLlm` 字符（默认 8000），控制 token 成本
- 构造 prompt，要求输出 JSON 格式，包含字段：
  - `summary`：1-3 句，描述文件整体职责
  - `purpose`：一句话描述业务功能
  - `methodNotes`：数组，按函数名给出简短说明（每项 ≤ 40 字）
- 调用 Qwen API（支持自定义 `baseUrl` 和 `model`）
- 若调用失败或无 API Key，使用兜底摘要（基于正则抽取的信息）

设计取舍：

- prompt 强制要求 JSON 输出，便于后续解析
- 温度设为 0.1，保证输出稳定
- 失败时兜底而非中断，保证索引流程的鲁棒性

#### 2.5 索引产物生成

对每个文件，生成一条记录：

```json
{
  "path": "src/index.js",
  "language": "JavaScript",
  "summary": "...",
  "purpose": "...",
  "functions": ["init", "runIndexer"],
  "methodNotes": ["init: 初始化配置", "runIndexer: 执行索引"],
  "dependencies": ["fs", "path"]
}
```

然后生成两层索引：

- **文件级索引**：包含所有文件的详细记录
  - 输出 `file-index.json` 和 `file-index.md`
- **模块级索引**：按目录聚合，统计每个模块的文件数、函数数、依赖数、用途摘要
  - 输出 `module-index.json` 和 `module-index.md`

设计取舍：

- 同时输出 JSON 和 Markdown，JSON 便于程序消费，Markdown 便于人类阅读
- 模块级索引帮助 AI 先理解业务边界，再下钻细节

#### 2.6 暂存区更新（可选）

若指定 `--stage-output`，调用 `git add` 将所有索引产物加入暂存区。

设计取舍：

- 这个选项适合“提交即更新文档”的场景，避免“代码改了，文档没跟上”
- 但默认不开启，避免用户不熟悉时误提交

---

### 3) Git 集成阶段（`hooks setup`）

设置 Git 使用 `.githooks` 目录作为 hooks 路径：

- 检查当前目录是否为 git 仓库（`git rev-parse --is-inside-work-tree`）
- 检查 `.githooks/pre-commit` 是否存在
- 设置 `git config core.hooksPath .githooks`

设计取舍：

- 使用 `.githooks` 而非 `.git/hooks`，原因：
  - `.githooks` 可以被 git 跟踪，便于团队共享
  - 避免每个开发者手动复制 hooks

---

## 配置文件设计

`.ai-indexer.config.json` 的核心字段：

- `includeExtensions`：纳入索引的文件类型
- `excludeGlobs`：忽略目录（如 `node_modules`、`dist`）
- `outputDir`：索引产物输出目录（默认 `.ai/`）
- `jsonOutput`、`mdOutput`、`moduleMdOutput`、`moduleJsonOutput`：各类输出文件名
- `llm.provider`、`llm.baseUrl`、`llm.model`：LLM 配置
- `maxFileCharsForLlm`：控制输入 token 成本

设计取舍：

- 配置文件放在项目根目录，便于版本控制
- 默认值经过实践验证，开箱即用
- 支持自定义 LLM provider，便于扩展

---

## 为什么做成 npm CLI？

从“脚本”升级为“CLI”的核心收益：

- **统一入口**：降低团队认知成本
- **可发布、可复用**：不依赖单仓库私有脚本
- **便于接入 CI/CD**：可以在流水线中自动执行
- **对外扩展更自然**：未来可加 provider、解析器、输出格式

---

## 技术债务与后续迭代

当前实现的一些已知限制：

- 函数和依赖抽取使用正则，可能在复杂语法下出错（如装饰器、泛型）
- LLM 调用是串行的，大仓库可能较慢
- 模块级索引只按目录聚合，未考虑实际依赖关系

后续迭代方向：

- 引入轻量 AST 解析（如 `@babel/parser`、`esprima`）提升抽取准确性
- 支持并行 LLM 调用，提升大仓库索引速度
- 增强模块关系图（调用链/依赖拓扑）
- 支持更多模型提供商与本地模型
- 增加 CI 模式（PR 自动更新并校验索引）

---

## 一句话总结

`ai-file-indexer` 本质上是在做一件事：
**把“给 AI 解释项目”从一次性对话，变成可持续、可自动化的工程资产。**

从技术角度看，它是一个典型的“工程化工具”：通过配置化、模块化、可扩展的设计，把一个重复性动作标准化，并集成到现有开发流程中。

---

## 相关链接

- GitHub 仓库：https://github.com/adouwt/files-introduction-for-ai
