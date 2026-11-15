# audit-sluice

代码审计 CLI：规则驱动（YAML 声明）+ AST/正则检查 + 评分 + 豁免，**单行 JSON 契约**输出。
不依赖任何宿主（不是 DSH 插件），可单独用于任意本地仓库。

## 用法

```bash
# 全量审计（stdout 一行 JSON；有 blocker ⇒ exit 1，执行失败 ⇒ exit 2）
node cli.mjs --repo /path/to/repo --scope full --json

# 只看改动集
node cli.mjs --repo /path/to/repo --scope diff --json
```

安装后（`npm i -g audit-sluice` 或 `npx audit-sluice`）：

```bash
audit-sluice --repo . --scope full --json
```

## 输出契约

`stdout` **只有一行 JSON**（日志/告警一律走 `stderr`）：

```json
{"ok":true,"scope":"full","summary":{"blocker":0,"warning":0,"notice":0,"total":0},
 "quality":{"score":100,"level":"A","dims":{},"counts":{},"weights":{}},"findings":[],"files":123}
```

| 退出码 | 含义 |
|---|---|
| `0` | 无 blocker |
| `1` | 有 blocker（拦截） |
| `2` | 执行失败（参数错误 / 内部异常 / 引擎不可用） |

## 目录结构

```
cli.mjs                 命令行入口（唯一根级 .js）
package.json
lib/                    被 import 的库代码（无构建）
├── shared/             零依赖且语义通用（拷走即用，例如 tokenizer）
├── ast/                AST / 语法树 / 词法分析
├── engine/             审计引擎（收集 → 逐文件检查 → 汇总 → 报告）
├── checks/             单规则检查器实现
├── rule/               规则加载与编译（把 YAML 声明编译成检查器）
├── rules/              规则内容（YAML 包，23 个）
├── exempt/             豁免标记（dsh-skip-*）与目录类别豁免
├── score/              评分（对数衰减 + 动态权重）
├── preprocess/         中间层：引擎适配器 / 豁免编排 / 评分编排 / 结果文案
├── lint-adapter/       外部 lint 工具适配
├── link-check/         链接检查
├── ui-sdk/             审计面板注入契约（供 UI 侧实现）
└── core/               配置 / 凭据 / 进程执行等基础设施
scripts/                本项目自己的脚本（文档树 / 函数索引生成）
test/                   测试 + fixtures
docs/                   设计与说明
```

**目录判据**：`lib/shared/` 只收「**技术上零依赖且语义上通用**」的文件（拷到别的项目也成立）；
只满足第一条不算 —— 评分口径、`dsh-skip-*` 标记这类是本项目的约定，留在 `lib/`。

## 依赖

- `js-yaml`（解析规则包）
- `web-tree-sitter` + `tree-sitter-wasms`（可选：AST 增强，缺失时退化为正则/词法检查，**不影响能否跑**）

## 许可

MIT
