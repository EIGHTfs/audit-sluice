# audit-sluice

代码审计 CLI。规则用 YAML 声明，AST/正则检查 + 评分 + 豁免，输出单行 JSON。

不依赖任何宿主，可单独用于任意本地仓库。

## 用法

```bash
# 审计（子命令可省略：audit-sluice --repo . 等价于 audit-sluice audit --repo .）
audit-sluice audit --repo <路径> --scope diff|full --json

# 私有库：只报告不拦截
audit-sluice audit --repo <路径> --visibility private --json

# 本次临时豁免（仅本次、不落盘）
audit-sluice audit --repo <路径> --exempt-paths a.js,b.js --exempt-reason <理由> --json

# 预处理清单（宿主据此挂路由 / 注册工具）
audit-sluice manifest --json

# 配置：看生效值 / 机器可读 / 迁移旧配置
audit-sluice config
audit-sluice config --json
audit-sluice config --migrate
```

| 参数 | 说明 |
|---|---|
| `--repo <路径>` | 仓库绝对路径（必填；不存在或不是目录 ⇒ exit 2） |
| `--scope diff\|full` | 审计范围（默认 `diff`） |
| `--visibility private\|public\|unknown` | 默认 `unknown`，与 `public` 同口径；仅 `private` 只报告不拦截 |
| `--exempt-paths a,b` | 本次临时豁免的相对路径（逗号分隔） |
| `--exempt-reason <理由>` | 豁免理由（仅回显） |
| `--ruleset <目录>` | 自定义规则目录 |
| `--weights <json>` | 维度权重覆盖 |
| `--json` | stdout 输出单行 JSON |
| `--max-scan-files <n>` | 全量扫描文件上限（0=不限，默认 3000） |
| `--disabled-slots a,b` | 本次禁用这些规则包 |
| `--slots a,b` | 只用这些规则包 |

## 配置

位置（首个存在者生效）：

1. `$AUDIT_SLUICE_HOME/config.json`
2. `$DSH_HOME/audit-sluice/config.json`
3. `~/.audit-sluice/config.json`

```json
{
  "scanScope": "diff",
  "maxScanFiles": 3000,
  "disabledSlots": ["i18n"],
  "weightOverrides": { "安全性": 100 }
}
```

优先级：命令行参数 > 配置文件 > 内置默认。

`config` 输出会标出每个键的来源；`config --migrate` 把旧版宿主配置里的审计项落到本包配置。

## library 用法

```js
import { audit, preprocessManifest } from 'audit-sluice';

const result = await audit({ repoPath: '/path/to/repo', scope: 'full', visibility: 'unknown' });
```

返回 `{ ok, scope, summary, quality, findings, blocked, exempt, privateExempt, files, engine }`。

`blocked` 是豁免后的拦截结论（门禁依据）；`summary.blocker` 是引擎原始计数（问题规模）。

## 输出契约

`stdout` 只有一行 JSON，日志与告警走 `stderr`：

```json
{"ok":true,"scope":"full","summary":{"blocker":0,"warning":0,"notice":0,"total":0},
 "quality":{"score":100,"level":"A"},"findings":[],"files":123}
```

| 退出码 | 含义 |
|---|---|
| `0` | 无 blocker |
| `1` | 有 blocker（拦截） |
| `2` | 执行失败（参数错误 / 内部异常 / 引擎不可用） |

## 规则包

25 个槽位 / 172 条规则，全部用 YAML 声明在 `lib/rules/`。新建 `audit-rules-<名>.yml` 即自动成为槽位，不需要改代码。

| 槽位 | 规则数 | 槽位 | 规则数 |
|---|---|---|---|
| nodejs | 37 | csharp | 3 |
| frontend | 26 | i18n | 3 |
| npm | 17 | docs | 1 |
| performance | 12 | dotenv | 1 |
| dsh | 10 | filehealth | 1 |
| comment / java / python | 7 | robustness | 1 |
| paths / php | 6 | shell | 1 |
| cpp / go / rust / swift | 5 | structure | 1 |
| folder | 4 | template | 1 |
| — | — | private | 0 |

逐条规则说明见 [docs/功能-审计规则体系.md](https://github.com/EIGHTfs/audit-sluice/blob/master/docs/%E5%8A%9F%E8%83%BD-%E5%AE%A1%E8%AE%A1%E8%A7%84%E5%88%99%E4%BD%93%E7%B3%BB.md)。

## 豁免

| 方式 | 写法 | 效果 |
|---|---|---|
| 行内标记 | `// dsh-skip-sensitive` | 文件头=整文件，行尾=单行 |
| 目录标记 | 目录里放空文件 `.samples` | 照常出结果但不拦截 |
| 目录标记 | 目录里放空文件 `.test` | 整目录完全跳过 |
| 忽略清单 | 仓库根 `.auditignore` | 所列文件不参与审计 |
| 临时豁免 | `--exempt-paths a,b` | 仅本次有效，不落盘 |
| 私有库 | `--visibility private` | 只报告不拦截 |

标记清单与逐条语义见 [docs/DETAILS-EXEMPT-AND-RULES.md](https://github.com/EIGHTfs/audit-sluice/blob/master/docs/DETAILS-EXEMPT-AND-RULES.md)。

## 目录结构

```
cli.mjs                 命令行入口
lib/                    库代码（无构建）
├── shared/             零依赖且语义通用
├── ast/                AST / 词法分析
├── engine/             审计引擎（收集 → 检查 → 汇总 → 报告）
├── checks/             单规则检查器
├── rule/               规则加载与编译
├── rules/              规则内容（YAML 包）
├── exempt/             豁免标记与目录类别豁免
├── score/              评分
├── preprocess/         中间层：引擎适配 / 豁免编排 / 评分编排 / 结果文案
├── lint-adapter/       外部 lint 工具适配
├── link-check/         链接检查
├── config/             本包配置
└── core/               git 进程执行与包根定位
scripts/                文档树 / 函数索引生成
test/                   测试 + fixtures
docs/                   设计与说明
```

## 文档

- [docs/功能-审计引擎.md](https://github.com/EIGHTfs/audit-sluice/blob/master/docs/%E5%8A%9F%E8%83%BD-%E5%AE%A1%E8%AE%A1%E5%BC%95%E6%93%8E.md) — 引擎总览：规则体系、判定流程、评分、外部 linter 委托、豁免通道
- [docs/功能-审计规则体系.md](https://github.com/EIGHTfs/audit-sluice/blob/master/docs/%E5%8A%9F%E8%83%BD-%E5%AE%A1%E8%AE%A1%E8%A7%84%E5%88%99%E4%BD%93%E7%B3%BB.md) — 规则作用域字段与逐条规则说明
- [docs/DETAILS-EXEMPT-AND-RULES.md](https://github.com/EIGHTfs/audit-sluice/blob/master/docs/DETAILS-EXEMPT-AND-RULES.md) — 豁免注释与规则 yml 全录
- [docs/FUNCTIONS.md](https://github.com/EIGHTfs/audit-sluice/blob/master/docs/FUNCTIONS.md) — 全部函数索引（自动生成）
- [docs/PERF-BASELINE.md](https://github.com/EIGHTfs/audit-sluice/blob/master/docs/PERF-BASELINE.md) — 性能基线

## 依赖

- `js-yaml`（解析规则包）
- `web-tree-sitter` + `tree-sitter-wasms`（可选，AST 增强；缺失时退化为正则/词法检查）

## 许可

MIT
