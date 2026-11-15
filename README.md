# audit-sluice

代码审计 CLI：规则驱动（YAML 声明）+ AST/正则检查 + 评分 + 豁免，**单行 JSON 契约**输出。
不依赖任何宿主（不是 DSH 插件），可单独用于任意本地仓库。

## 用法

```bash
# 审计（子命令可省略：`audit-sluice --repo .` 等价于 `audit-sluice audit --repo .`）
audit-sluice audit --repo /path/to/repo --scope full --json
audit-sluice audit --repo . --scope diff --json

# 私有库：只报告不拦截（blocked 为空，privateExempt 里带「本来会拦几条」）
audit-sluice audit --repo . --scope full --visibility private --json

# 本次临时豁免（仅本次、不落盘；豁免即豁免，含 blocker）
audit-sluice audit --repo . --scope full --exempt-paths src/gen.js,dist/bundle.js --exempt-reason "生成产物" --json

# 预处理清单（宿主据此挂路由 / 注册工具）
audit-sluice manifest --json
```

| 参数 | 说明 |
|---|---|
| `--repo <path>` | 仓库绝对路径（**必填**；不存在或不是目录 ⇒ exit 2） |
| `--scope diff\|full` | 审计范围（默认 `diff`） |
| `--visibility private\|public\|unknown` | 默认 `unknown`：**与 public 同口径（保守拦截）**；只有明确 `private` 才只报告不拦截 |
| `--exempt-paths a,b` | 本次临时豁免的相对路径（逗号分隔） |
| `--exempt-reason <r>` | 豁免理由（仅回显） |
| `--ruleset <dir>` / `--weights <json>` | 自定义规则目录 / 维度权重覆盖 |
| `--json` | stdout 输出单行 JSON 契约 |

## library 用法

```js
import { audit, preprocessManifest } from 'audit-sluice';

const result = await audit({ repoPath: '/path/to/repo', scope: 'full', visibility: 'unknown' });
// result.blocked 是**豁免后**的拦截结论（门禁依据）；
// result.summary.blocker 是引擎**原始**计数（问题规模）——两者刻意不同，别合并。
```

返回字段：`{ ok, scope, summary, quality, findings, blocked, exempt, privateExempt, files, engine }`。
`ok` = `blocked.length === 0`（私有库恒 true）。

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

## 运维备注：在 CIFS 挂载上初始化本仓库

`safe-delete`/`chmod` 受限的 SMB/CIFS 挂载上，直接 `git init` 会失败：
`chmod on .git/config.lock failed: Operation not permitted`（git 试图给锁文件改权限，被挂载点拒绝）。
变通做法（已在本机验证）：

```bash
# ① 在本地盘初始化一个空仓库，再把它的 .git 拷进来
mkdir -p /tmp/as-init && git -C /tmp/as-init init -q
cp -r /tmp/as-init/.git <本项目>/.git

# ② 让 git 信任该目录（否则报 dubious ownership）
git config --global --add safe.directory <本项目绝对路径>

# ③ 验证
git -C <本项目> status --short
```

`node_modules/` 已在 `.gitignore` 中（依赖用 `npm i` 或从同机已有副本复制，**不入库**）。
