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

# 本包自己的配置（扫描范围 / 文件上限 / 禁用规则包 / 权重覆盖）
audit-sluice config            # 看生效值、来源与被忽略的键
audit-sluice config --json     # 机器可读
audit-sluice config --migrate  # 把宿主遗留配置里的审计项落盘到本包配置
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
| `--max-scan-files <n>` | 全量扫描文件上限（0=不限；默认取配置，缺省 3000） |
| `--disabled-slots a,b` | 本次禁用这些规则包（默认取配置） |
| `--slots a,b` | 只用这些规则包（显式白名单，默认不限定） |

## 配置（本包自己的一份）

「怎么审」由本包自己的配置决定，不依赖宿主：

```bash
# 位置（首个存在者生效）：
#   1. $AUDIT_SLUICE_HOME/config.json
#   2. $DSH_HOME/audit-sluice/config.json
#   3. ~/.audit-sluice/config.json
audit-sluice config --json
```

```json
{
  "scanScope": "diff",
  "maxScanFiles": 3000,
  "disabledSlots": ["i18n"],
  "weightOverrides": { "安全性": 100 }
}
```

优先级：**命令行参数 > 配置文件 > 内置默认**。
旧版宿主配置（`$DSH_HOME/git-push/config.json`）里的审计项在**本包没配该项时**作为兜底读取，
并在 `config` 输出里标出来源；`config --migrate` 把它落到本包配置（不动宿主配置文件）。

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
├── config/             本包自己的配置（扫描范围 / 文件上限 / 禁用规则包 / 权重覆盖）
└── core/               git 进程执行与包根定位
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

<!-- dshgp-functions:start -->
## 函数列表

### lib/actions.js（232 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readTextSafe` | 31-33 | 3 | `function readTextSafe(path = '') {` |
| `splitList` | 36-38 | 3 | `function splitList(value) {` |
| `auditReport` | 63-117 | 55 | `export async function auditReport({` |
| `auditHistory` | 126-133 | 8 | `export async function auditHistory({ repo = '', since = '', until = '', outDir = '', auditOpts = {}, weights = {} } = {}) {` |
| `ioScan` | 143-151 | 9 | `export async function ioScan({ root = '', writeOnly = false } = {}) {` |
| `linkCheck` | 158-162 | 5 | `export async function linkCheck({ path = '' } = {}) {` |
| `scopeCheck` | 172-208 | 37 | `export function scopeCheck({ repo = '', files = '', prefix = '', allowlist = [], topLevelMustBeEmpty } = {}) {` |
| `exemptAction` | 218-231 | 14 | `export async function exemptAction({` |

### lib/ast/brace.js（121 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `matchBrace` | 13-25 | 13 | `export function matchBrace(tokens, openIdx) {` |
| `matchParenForward` | 28-40 | 13 | `export function matchParenForward(tokens, startIdx) {` |
| `matchPairBack` | 52-61 | 10 | `export function matchPairBack(tokens, closeIdx, openPunct, closePunct) {` |
| `isBlockParen` | 71-83 | 13 | `export function isBlockParen(tokens, closeTok) {` |
| `matchingOpen` | 86-88 | 3 | `export function matchingOpen(tokens, closeIdx) {` |
| `collectInnerFnRanges` | 106-121 | 16 | `export function collectInnerFnRanges(tokens, from, to) {` |

### lib/ast/callgraph.js（135 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `buildCallGraph` | 23-42 | 20 | `export function buildCallGraph(text) {` |
| `isInRequestPath` | 52-68 | 17 | `export function isInRequestPath(fnName, graph, isRequestName) {` |
| `collectFunctionDecls` | 71-135 | 65 | `function collectFunctionDecls(tokens) {` |
| `collectArrowFns` | 93-135 | 43 | `function collectArrowFns(tokens) {` |
| `collectNamedFnRanges` | 120-122 | 3 | `export function collectNamedFnRanges(tokens) {` |
| `matchBraceIdx` | 125-135 | 11 | `function matchBraceIdx(tokens, openIdx) {` |

### lib/ast/code-lines.js（176 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeCodeLineFilter` | 24-47 | 24 | `export function makeCodeLineFilter(text = '', candidateLines = [], opts = {}) {` |
| `makeCodeSpanFilter` | 72-108 | 37 | `export function makeCodeSpanFilter(text = '', candidateLines = [], opts = {}) {` |
| `isProseDoc` | 122-124 | 3 | `function isProseDoc(text, file) {` |
| `makeProseCodeFilter` | 138-161 | 24 | `function makeProseCodeFilter(text, candidateLines) {` |
| `codeStringLiterals` | 168-175 | 8 | `export function codeStringLiterals(text = '') {` |

### lib/ast/control-flow.js（471 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectNamedSyncFs` | 27-58 | 32 | `function collectNamedSyncFs(tokens) { // dsh-skip-complexity: named-import 扫描器（import{..}→from 模式匹配，扫描结构必然嵌套）` |
| `collectAsyncRanges` | 61-79 | 19 | `function collectAsyncRanges(tokens) { // dsh-skip-complexity: async 函数体边界扫描器（token 遍历+配对，结构必然嵌套）` |
| `scanSyncCalls` | 82-108 | 27 | `function scanSyncCalls(tokens, namedSync, asyncRanges) { // dsh-skip-complexity: 同步 fs 调用扫描器（定位调用点+区间归属判定，结构必然嵌套）` |
| `checkSyncFs` | 111-116 | 6 | `export function checkSyncFs(text = '') {` |
| `checkEmptyCatchAst` | 123-177 | 55 | `export function checkEmptyCatchAst(text = '') { // dsh-skip-complexity: 空 catch 检测器本体（token 遍历 + catch 体空判定多条件链，职责单一）` |
| `checkComplexityAst` | 179-471 | 293 | `export function checkComplexityAst(text = '', { warn = 10, block = 20 } = {}) {` |
| `inInner` | 212-212 | 1 | `const inInner = (k) => innerRanges.some(([a, b]) => k >= a && k < b);` |
| `checkNestingDepthAst` | 256-471 | 216 | `export function checkNestingDepthAst(text = '', { warn = 4, block = 6 } = {}) { // dsh-skip-complexity: 嵌套深度统计器本体（统计 if/for 嵌套必然自身嵌套）` |
| `pythonDetectDef` | 336-338 | 3 | `function pythonDetectDef(text) {` |
| `checkPythonComplexity` | 352-376 | 25 | `function checkPythonComplexity(text, { warn, block }) {` |
| `checkPythonNesting` | 387-416 | 30 | `function checkPythonNesting(text, { warn, block }) {` |
| `indentOf` | 419-421 | 3 | `function indentOf(line) {` |
| `checkJavaKtComplexity` | 435-468 | 34 | `function checkJavaKtComplexity(tokens, ranges, { warn, block }) {` |

### lib/ast/credential.js（316 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPlaceholderText` | 48-50 | 3 | `function isPlaceholderText(text) {` |
| `stripQuotes` | 78-82 | 5 | `function stripQuotes(raw) {` |
| `isMeaningfulCredentialValue` | 101-112 | 12 | `export function isMeaningfulCredentialValue(raw) {` |
| `checkPlaceholderCredentialAst` | 136-160 | 25 | `export function checkPlaceholderCredentialAst(text = '', file = '') {` |
| `credentialNameTier` | 195-200 | 6 | `export function credentialNameTier(name) {` |
| `isHardcodedCredentialValue` | 206-215 | 10 | `export function isHardcodedCredentialValue(name, raw) {` |
| `isCredentialIdent` | 218-220 | 3 | `export function isCredentialIdent(name) {` |
| `scanCredentialTokens` | 229-269 | 41 | `function scanCredentialTokens(tokens, out, lineOffset = 0) {` |
| `literalAfterPrefix` | 282-291 | 10 | `function literalAfterPrefix(tokens, next, opIdx) {` |
| `checkCredentialRefAst` | 293-315 | 23 | `export function checkCredentialRefAst(text = '', tree = null) {` |

### lib/ast/dataflow.js（391 行 · 16 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDeclaredFnBodies` | 60-391 | 332 | `function collectDeclaredFnBodies(tokens) {` |
| `collectArrowMethodBodies` | 77-391 | 315 | `function collectArrowMethodBodies(tokens) {` |
| `collectPythonDefBodies` | 117-163 | 47 | `function collectPythonDefBodies(text, tokens) {` |
| `indentOf` | 122-125 | 4 | `const indentOf = (s) => {` |
| `isBlankOrComment` | 126-126 | 1 | `const isBlankOrComment = (s) => !s.trim() \|\| /^\s*#/.test(s);` |
| `mergeFnRanges` | 166-187 | 22 | `function mergeFnRanges(fnRanges, tokens) {` |
| `collectFnBodies` | 194-201 | 8 | `function collectFnBodies(tokens, text = '') {` |
| `prevNonWs` | 204-210 | 7 | `function prevNonWs(tokens, i) {` |
| `nextNonWs` | 213-220 | 8 | `function nextNonWs(tokens, i, to) {` |
| `applyArgWriteback` | 223-230 | 8 | `function applyArgWriteback(tokens, i, nxt, obj, clearMap) {` |
| `applyAssignClearOrWriteback` | 236-265 | 30 | `function applyAssignClearOrWriteback(tokens, i, to, t, nxt, obj, clearMap) {` |
| `applyClearMethods` | 271-289 | 19 | `function applyClearMethods(t, member, memberIdx, callOpen, tokens, obj, clearMap, i) {` |
| `applyAccessAfterClear` | 295-316 | 22 | `function applyAccessAfterClear(t, nxt, member, memberIdx, callOpen, tokens, i, obj, clearMap, out, to) {` |
| `isWriteSubscript` | 319-336 | 18 | `function isWriteSubscript(tokens, objIdx, to) {` |
| `scanClearThenAccess` | 346-369 | 24 | `function scanClearThenAccess(tokens, from, to) {` |
| `checkClearAccessAst` | 377-391 | 15 | `export function checkClearAccessAst(text = '') {` |

### lib/ast/dup-code.js（166 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDupCodeCandidates` | 41-78 | 38 | `export function collectDupCodeCandidates(text, file = '') {` |
| `findDuplicateBodies` | 86-110 | 25 | `export function findDuplicateBodies(perFileCandidates, opts = {}) {` |
| `countParams` | 113-166 | 54 | `function countParams(tokens, openIdx) {` |
| `hasBoolFlagParam` | 146-166 | 21 | `function hasBoolFlagParam(tokens, openIdx) {` |

### lib/ast/fs-hotspots.js（155 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `lineAt` | 38-42 | 5 | `function lineAt(text, idx) {` |
| `scanFsHotspotsText` | 50-119 | 70 | `export function scanFsHotspotsText(text = '', relPath = '') {` |
| `collect` | 58-67 | 10 | `const collect = (re) => {` |
| `fnNameAt` | 69-72 | 4 | `const fnNameAt = (at) => {` |
| `dups` | 78-87 | 10 | `const dups = (calls) => {` |
| `groupOf` | 91-95 | 5 | `const groupOf = (fn, at) => {` |
| `scanFsHotspots` | 126-154 | 29 | `export function scanFsHotspots(fileTexts = []) {` |

### lib/ast/io-risk-const.js（96 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isLoopHead` | 86-89 | 4 | `export function isLoopHead(t, prev) {` |
| `raise` | 92-95 | 4 | `export function raise(level, n = 1) {` |

### lib/ast/io-risk-fn.js（209 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `enclosingLoop` | 17-24 | 8 | `export function enclosingLoop(loops, line) {` |
| `findBody` | 44-209 | 166 | `export function findBody(tokens, from, window = BODY_SEARCH_TOKENS) {` |
| `findAsyncBody` | 57-65 | 9 | `export function findAsyncBody(tokens, i) {` |
| `findLoopRange` | 72-86 | 15 | `export function findLoopRange(tokens, i) {` |
| `endLineOf` | 89-91 | 3 | `export function endLineOf(tokens, range) {` |
| `seekLoopBody` | 98-209 | 112 | `export function seekLoopBody(tokens, i) {` |
| `isSingleStmtLoopClose` | 109-209 | 101 | `export function isSingleStmtLoopClose(tokens, j) {` |
| `classifySyncFnHead` | 122-149 | 28 | `export function classifySyncFnHead(tokens, i, t) {` |
| `rangeOf` | 152-156 | 5 | `export function rangeOf(tokens, open) {` |
| `findArrowBody` | 159-170 | 12 | `export function findArrowBody(tokens, i) {` |
| `findBodyAfterParen` | 178-209 | 32 | `export function findBodyAfterParen(tokens, parenIdx) {` |
| `matchParen` | 186-195 | 10 | `export function matchParen(tokens, parenIdx) {` |
| `classifyFnHead` | 202-208 | 7 | `export function classifyFnHead(tokens, i, t) {` |

### lib/ast/io-risk-loop.js（309 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isSmallLiteralCallee` | 24-31 | 8 | `export function isSmallLiteralCallee(tokens, methodIdx) {` |
| `isSmallPushedArray` | 47-58 | 12 | `export function isSmallPushedArray(tokens, name, ofIdx) {` |
| `findLiteralArrayDecl` | 65-74 | 10 | `export function findLiteralArrayDecl(tokens, name, ofIdx) {` |
| `countUnsafePushes` | 90-116 | 27 | `export function countUnsafePushes(tokens, name, ofIdx) {` |
| `loopHeadSpan` | 121-309 | 189 | `export function loopHeadSpan(tokens, i) {` |
| `matchParenIn` | 139-148 | 10 | `function matchParenIn(tokens, openIdx) {` |
| `insideLoopOver` | 160-181 | 22 | `export function insideLoopOver(tokens, idx) {` |
| `isLoopBodyBrace` | 193-201 | 9 | `export function isLoopBodyBrace(tokens, braceIdx) {` |
| `isSmallFixedLoop` | 210-229 | 20 | `export function isSmallFixedLoop(tokens, i) {` |
| `findOfKeyword` | 236-309 | 74 | `export function findOfKeyword(tokens, i) {` |
| `countLiteralElements` | 254-272 | 19 | `export function countLiteralElements(tokens, fromIdx) {` |
| `collectRanges` | 281-308 | 28 | `export function collectRanges(tokens) {` |

### lib/ast/io-risk.js（315 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `classifyIoCall` | 55-65 | 11 | `function classifyIoCall(tokens, idx) {` |
| `judgeIoTokend` | 75-104 | 30 | `function judgeIoTokend(ctx) {` |
| `detectRequestContext` | 107-112 | 6 | `function detectRequestContext(lines, fnRange) {` |
| `gradeRisk` | 125-164 | 40 | `function gradeRisk({ isSync, inAsync, inLoop, inSmallFixedLoop, inRequest, inParallelAll, kind }) {` |
| `findMatchingClose` | 167-177 | 11 | `function findMatchingClose(tokens, openIdx) {` |
| `findPromiseAllRanges` | 186-199 | 14 | `function findPromiseAllRanges(tokens) {` |
| `scanIoRiskAst` | 206-245 | 40 | `export function scanIoRiskAst(text = '') {` |
| `within` | 215-215 | 1 | `const within = (ranges, line) => ranges.some(([s, e]) => line >= s && line <= e);` |
| `enclosingFnText` | 223-227 | 5 | `const enclosingFnText = (line) => {` |
| `fnNameAt` | 229-236 | 8 | `const fnNameAt = (line) => {` |
| `summarizeIoRisk` | 252-273 | 22 | `export function summarizeIoRisk(hits = []) {` |
| `rankIoFixList` | 280-284 | 5 | `export function rankIoFixList(hits = []) {` |
| `compareFixPriority` | 291-301 | 11 | `function compareFixPriority(a, b) {` |
| `isWriteLike` | 304-306 | 3 | `function isWriteLike(kind) {` |
| `isSync` | 309-311 | 3 | `function isSync(type) {` |

### lib/ast/lang.js（156 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `prevNonWsToken` | 58-65 | 8 | `function prevNonWsToken(tokens, i) {` |
| `isMethodCandidate` | 68-73 | 6 | `function isMethodCandidate(prev) {` |
| `findMatchingParen` | 76-85 | 10 | `function findMatchingParen(tokens, openIdx) {` |
| `findOpenBrace` | 88-156 | 69 | `function findOpenBrace(tokens, closeIdx) {` |
| `javaKtFuncRanges` | 100-123 | 24 | `export function javaKtFuncRanges(text = '') {` |
| `detectLang` | 131-142 | 12 | `export function detectLang(text = '') {` |

### lib/ast/line-count.js（53 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `lineStats` | 26-43 | 18 | `export function lineStats(text) {` |
| `codeLineCount` | 50-52 | 3 | `export function codeLineCount(text) {` |

### lib/ast/magic-number.js（273 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMagicNumberSmartAst` | 51-152 | 102 | `export function checkMagicNumberSmartAst(text = '', {` |
| `hintTest` | 57-60 | 4 | `const hintTest = (hints) => {` |
| `scanBackToEquals` | 155-173 | 19 | `function scanBackToEquals(tokens, numIdx) {` |
| `checkConstPrefix` | 176-207 | 32 | `function checkConstPrefix(tokens, eqIdx) {` |
| `isNamedConstantValue` | 217-224 | 8 | `function isNamedConstantValue(tokens, numIdx) {` |
| `collectPythonEnumAssignLines` | 246-272 | 27 | `function collectPythonEnumAssignLines(text) {` |

### lib/ast/naming.js（293 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkNameLengthAst` | 27-192 | 166 | `export function checkNameLengthAst(text = '', { min = 2, allow = [] } = {}) {` |
| `checkShortFunctionNameAst` | 206-228 | 23 | `export function checkShortFunctionNameAst(text = '', { max = 2, allow = [], tree = null } = {}) {` |
| `isShortName` | 213-213 | 1 | `const isShortName = (name) => String(name).length <= max && !ALLOW.has(name);` |
| `checkSmallFileReadAst` | 244-267 | 24 | `export function checkSmallFileReadAst(text = '') {` |
| `checkConsoleLogJsonAst` | 276-292 | 17 | `export function checkConsoleLogJsonAst(text = '') {` |

### lib/ast/perf.js（489 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `matchingBrace` | 22-33 | 12 | `function matchingBrace(text, openIdx) {` |
| `matchingParen` | 36-47 | 12 | `function matchingParen(text, openIdx) {` |
| `lineOf` | 50-54 | 5 | `function lineOf(text, idx) {` |
| `inCommentOrString` | 63-69 | 7 | `function inCommentOrString(tokens, line, matchText) {` |
| `nextBlockRange` | 72-489 | 418 | `function nextBlockRange(text, startIdx) {` |
| `collectLoopRanges` | 86-102 | 17 | `function collectLoopRanges(text) {` |
| `loopBodyLines` | 109-118 | 10 | `export function loopBodyLines(text = '') {` |
| `innermostLoopRanges` | 146-149 | 4 | `function innermostLoopRanges(text) {` |
| `repeatIdenticalCallLines` | 175-203 | 29 | `export function repeatIdenticalCallLines(text = '') {` |
| `scanRange` | 180-196 | 17 | `const scanRange = (a, b) => {` |
| `loopFullCollectionLines` | 217-232 | 16 | `export function loopFullCollectionLines(text = '') {` |
| `collectFuncRanges` | 242-489 | 248 | `export function collectFuncRanges(text) {` |
| `directFullWriters` | 261-268 | 8 | `function directFullWriters(text) {` |
| `blankCommentsAndLiterals` | 279-341 | 63 | `function blankCommentsAndLiterals(text) {` |
| `isRegexStart` | 284-291 | 8 | `const isRegexStart = (idx) => {` |
| `loopNoFallbackReturnLines` | 361-389 | 29 | `export function loopNoFallbackReturnLines(text = '') {` |
| `loopFullRewriteCallLines` | 405-431 | 27 | `export function loopFullRewriteCallLines(text = '') {` |
| `nestedLinearScanLines` | 444-462 | 19 | `export function nestedLinearScanLines(text = '') {` |
| `longSyncLoopLines` | 474-488 | 15 | `export function longSyncLoopLines(text = '') {` |

### lib/ast/scope-collisions.js（229 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `analyzeScopeCollisions` | 49-229 | 181 | `export function analyzeScopeCollisions(text = '', {` |
| `nearestFunctionFrame` | 85-88 | 4 | `const nearestFunctionFrame = () => {` |

### lib/ast/scope.js（242 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectFnLineRanges` | 19-35 | 17 | `export function collectFnLineRanges(text) {` |
| `collectLoopLineRanges` | 38-57 | 20 | `export function collectLoopLineRanges(text) {` |
| `braceCloseIdx` | 60-70 | 11 | `function braceCloseIdx(tokens, openIdx) {` |
| `classifyFunctionPath` | 88-93 | 6 | `export function classifyFunctionPath(fnName = '') {` |
| `classifyLineScope` | 100-104 | 5 | `export function classifyLineScope(text, line) {` |
| `isModuleConstAssignment` | 113-137 | 25 | `export function isModuleConstAssignment(text, line) { // dsh-skip-complexity: 模块级常量判定器（顶层过滤+常量名风格+行内=num 多条件链，职责单一）` |
| `analyzeFunctionalScope` | 146-154 | 9 | `export function analyzeFunctionalScope(text = '') {` |
| `collectFnNames` | 157-184 | 28 | `function collectFnNames(tokens) { // dsh-skip-complexity: 函数名收集器（function/const function/箭头三形态扫描，拆分后职责单一）` |
| `scanReturnExposed` | 187-196 | 10 | `function scanReturnExposed(tokens, fnNames, scope) {` |
| `scanAssignmentExposed` | 200-227 | 28 | `function scanAssignmentExposed(tokens, fnNames, scope) { // dsh-skip-complexity: this/exports/module 赋值暴露扫描（三前缀分支为结构必然）` |
| `scanCallbackPassed` | 230-241 | 12 | `function scanCallbackPassed(tokens, fnNames, scope) {` |

### lib/ast/shell.js（132 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `shellCdDynamicLines` | 22-45 | 24 | `export function shellCdDynamicLines(text) {` |
| `parseGitignore` | 50-76 | 27 | `function parseGitignore(text) {` |
| `isIgnored` | 79-85 | 7 | `function isIgnored(target, patterns) {` |
| `extractWriteTarget` | 88-94 | 7 | `function extractWriteTarget(line) {` |
| `writeIntoGitignoredLines` | 106-131 | 26 | `export function writeIntoGitignoredLines(text, repoPath = '') {` |

### lib/ast/size.js（449 行 · 13 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `funcNameAt` | 31-45 | 15 | `function funcNameAt(tokens, i) {` |
| `pythonFuncRanges` | 60-84 | 25 | `export function pythonFuncRanges(text = '') {` |
| `maxFunctionLength` | 95-101 | 7 | `export function maxFunctionLength(text = '') {` |
| `arrowAndMethodRanges` | 130-449 | 320 | `function arrowAndMethodRanges(tokens) {` |
| `push` | 132-136 | 5 | `const push = (range, name) => {` |
| `funcRangesAst` | 165-449 | 285 | `export function funcRangesAst(text = '') {` |
| `countCommentLinesInRange` | 213-226 | 14 | `export function countCommentLinesInRange(tokens, startLine = 1, endLine = Infinity) {` |
| `checkFuncLinesAst` | 236-253 | 18 | `export function checkFuncLinesAst(text = '', { warn = FUNC_LINES_WARN, block = FUNC_LINES_BLOCK } = {}) {` |
| `checkFuncDensityAst` | 277-298 | 22 | `export function checkFuncDensityAst(text = '', { threshold = FUNC_LINES_WARN, blockThreshold = FUNC_LINES_BLOCK, skipLines = new Set() } = {}) {` |
| `countCommentLines` | 306-319 | 14 | `export function countCommentLines(text = '') {` |
| `checkFileLines` | 330-339 | 10 | `export function checkFileLines(text = '', { warn = 500, block = 1000, excludeComments = true } = {}) {` |
| `checkCommentDensityAst` | 361-396 | 36 | `export function checkCommentDensityAst(text = '', { warn = COMMENT_DENSITY_WARN_DEFAULT, minCodeLines = 5 } = {}) {` |
| `checkRepeatedStringsAst` | 406-448 | 43 | `export function checkRepeatedStringsAst(text = '', { min = 3, ignore = [] } = {}) {` |

### lib/ast/symbol-index.js（400 行 · 22 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `sanitizeId` | 39-41 | 3 | `export function sanitizeId(input) {` |
| `symbolId` | 49-52 | 4 | `export function symbolId(relPath, name) {` |
| `unquote` | 55-58 | 4 | `function unquote(raw) {` |
| `collectDeclarations` | 61-78 | 18 | `function collectDeclarations(tokens) {` |
| `collectEsmImports` | 84-114 | 31 | `function collectEsmImports(tokens) {` |
| `collectCjsImports` | 120-137 | 18 | `function collectCjsImports(tokens) {` |
| `collectCallSites` | 147-164 | 18 | `function collectCallSites(tokens, fnRanges) {` |
| `isMemberAccess` | 167-175 | 9 | `function isMemberAccess(tokens, idx) {` |
| `findEnclosingFn` | 178-183 | 6 | `function findEnclosingFn(idx, fnRanges) {` |
| `extractFileSymbols` | 191-202 | 12 | `export function extractFileSymbols(relPath, text) {` |
| `resolveSpecifier` | 211-236 | 26 | `export function resolveSpecifier(relPath, source, fileSet) {` |
| `buildSymbolIndex` | 244-254 | 11 | `export function buildSymbolIndex(files = [], opts = {}) {` |
| `collectExports` | 257-267 | 11 | `function collectExports(perFile) {` |
| `flattenSymbols` | 270-282 | 13 | `function flattenSymbols(exportsByFile, perFile) {` |
| `buildNameIndex` | 285-294 | 10 | `function buildNameIndex(exportsByFile) {` |
| `resolveCalls` | 297-313 | 17 | `function resolveCalls(perFile, exportsByFile, fileSet) {` |
| `buildImportMap` | 316-328 | 13 | `function buildImportMap(rel, imports, fileSet, exportsByFile) {` |
| `resolveOne` | 331-337 | 7 | `function resolveOne(rel, call, localNames, importMap, byName) {` |
| `indexStats` | 340-359 | 20 | `function indexStats(perFile, symbols, edges, unresolved) {` |
| `callersOf` | 362-370 | 9 | `export function callersOf(index, id) {` |
| `unusedExportCandidates` | 377-391 | 15 | `export function unusedExportCandidates(index) {` |
| `indexSummary` | 394-399 | 6 | `export function indexSummary(index) {` |

### lib/ast/treesitter.js（414 行 · 19 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveDirs` | 46-56 | 11 | `function resolveDirs() {` |
| `pick` | 48-50 | 3 | `const pick = (spec) => {` |
| `treesitterAvailable` | 94-102 | 9 | `export function treesitterAvailable() {` |
| `availableGrammars` | 105-115 | 11 | `export function availableGrammars() {` |
| `grammarForExt` | 118-121 | 4 | `export function grammarForExt(ext = '') {` |
| `loadModule` | 126-139 | 14 | `async function loadModule() {` |
| `ensureInit` | 142-155 | 14 | `async function ensureInit() {` |
| `getParser` | 158-179 | 22 | `async function getParser(grammar) {` |
| `parseText` | 182-198 | 17 | `export async function parseText(text, grammar) {` |
| `isOpaqueNode` | 201-208 | 8 | `export function isOpaqueNode(node) {` |
| `confirmHits` | 218-237 | 20 | `export async function confirmHits({ text, ext = '', grammar = '', hits = [] } = {}) {` |
| `makeSyncConfirmer` | 249-268 | 20 | `export function makeSyncConfirmer(tree) {` |
| `fn` | 251-263 | 13 | `const fn = (line, col) => {` |
| `credentialLinesFromTree` | 288-355 | 68 | `export function credentialLinesFromTree(tree, credHit) {` |
| `isPlainLiteral` | 299-305 | 7 | `const isPlainLiteral = (node) => {` |
| `walk` | 307-348 | 42 | `const walk = (node) => {` |
| `shortFunctionNamesFromTree` | 373-405 | 33 | `export function shortFunctionNamesFromTree(tree, isShort) {` |
| `walk` | 380-398 | 19 | `const walk = (node) => {` |
| `resetTreeSitterCache` | 408-413 | 6 | `export function resetTreeSitterCache() {  modPromise = null;` |

### lib/blocked.js（121 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normalizeExemptPath` | 29-31 | 3 | `export function normalizeExemptPath(value) {` |
| `normalizeExemptPaths` | 34-38 | 5 | `export function normalizeExemptPaths(exemptPaths) {` |
| `computeBlocked` | 63-120 | 58 | `export function computeBlocked(findings = [], opts = {}) {` |
| `isExemptFile` | 66-66 | 1 | `const isExemptFile = (finding) => exemptSet.size > 0 && exemptSet.has(normalizeExemptPath(finding.file));` |

### lib/capabilities.js（156 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ruleSlotStats` | 37-44 | 8 | `function ruleSlotStats(loaded) {` |
| `listRuleSlots` | 47-81 | 35 | `export function listRuleSlots(order, disabledSlots, hitStats = null) {` |
| `ruleDetail` | 84-86 | 3 | `export function ruleDetail(slot) {` |
| `toggleRule` | 89-91 | 3 | `export function toggleRule(slot, disabled) {` |
| `auditAggregate` | 98-125 | 28 | `export async function auditAggregate(options = {}) {` |
| `auditParams` | 128-130 | 3 | `export function auditParams(cfg = {}, hasBuiltinEngine) {` |
| `renderAuditResult` | 133-135 | 3 | `export function renderAuditResult(ctx = {}, cfg = {}) {` |
| `exemptMarkerKeys` | 138-140 | 3 | `export function exemptMarkerKeys() {` |
| `isReadableTextFile` | 143-145 | 3 | `export function isReadableTextFile(path = '') {` |
| `defaultReportDir` | 148-150 | 3 | `export function defaultReportDir(repo = '') {` |
| `readTextIfPossible` | 153-155 | 3 | `export function readTextIfPossible(path = '') {` |

### lib/checks/button-bind.js（348 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readBalancedCall` | 28-48 | 21 | `export function readBalancedCall(text, startIdx, maxLen = 4000) {` |
| `extractJsxButtons` | 60-92 | 33 | `export function extractJsxButtons(text) {` |
| `stripCommentLines` | 106-120 | 15 | `function stripCommentLines(text) {` |
| `checkButtonBindings` | 138-348 | 211 | `export function checkButtonBindings({ file, text, rules, fileScope = '' }) {` |

### lib/checks/common.js（171 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `capSeverity` | 35-41 | 7 | `export function capSeverity(ruleSeverity, internalLevel) {` |
| `groupByKind` | 52-61 | 10 | `export function groupByKind(compiled) {` |
| `smartHitLines` | 70-73 | 4 | `export function smartHitLines(text) {` |
| `smallFileReadLines` | 83-87 | 5 | `export function smallFileReadLines(text) {` |
| `consoleLogJsonLines` | 95-97 | 3 | `export function consoleLogJsonLines(text) {` |
| `shortFuncNameLines` | 105-107 | 3 | `export function shortFuncNameLines(text, tree) {` |
| `placeholderCredentialLines` | 118-120 | 3 | `export function placeholderCredentialLines(text, file) {` |
| `credentialValueLines` | 122-124 | 3 | `export function credentialValueLines(text, tree) {` |
| `ioRiskLines` | 138-140 | 3 | `export function ioRiskLines(text) {` |
| `ioRiskDetail` | 148-156 | 9 | `export function ioRiskDetail(text) {` |
| `shellCdDynamicLines` | 158-160 | 3 | `export function shellCdDynamicLines(text) {` |
| `writeIntoGitignoredLines` | 167-169 | 3 | `export function writeIntoGitignoredLines(text, repoPath) {` |

### lib/checks/credential-file.js（44 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkCredentialFiles` | 13-43 | 31 | `export function checkCredentialFiles({ file, relPath, rules }) {` |

### lib/checks/dataflow.js（41 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDataflow` | 25-40 | 16 | `export function checkDataflow({ file, text, rules }) {` |

### lib/checks/dispatch.js（118 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveFileScope` | 48-56 | 9 | `function resolveFileScope({ repoPath, relPath }) {` |
| `runChecks` | 58-117 | 60 | `export function runChecks({ file, relPath, text, grouped }, opts = {}) {` |

### lib/checks/dup-code.js（70 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkDuplicateCode` | 28-69 | 42 | `export function checkDuplicateCode(fileTexts = [], rules = null) {` |

### lib/checks/dup-const.js（233 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extractFromConst` | 46-66 | 21 | `function extractFromConst(tokens, i, atTopLevel, push) {` |
| `extractFromJavaFinal` | 72-80 | 9 | `function extractFromJavaFinal(tokens, i, push) {` |
| `createConstPusher` | 100-116 | 17 | `function createConstPusher(out) {` |
| `extractConstAtToken` | 124-148 | 25 | `function extractConstAtToken(tokens, i, { lang, atTopLevel, push }) {` |
| `findConstDefs` | 150-175 | 26 | `export function findConstDefs(text = '') {` |
| `atTopLevel` | 160-160 | 1 | `const atTopLevel = (line) => /^\S/.test(lines[line - 1] \|\| '');` |
| `checkDuplicateConst` | 183-232 | 50 | `export function checkDuplicateConst(fileTexts = [], rules = null) {` |

### lib/checks/file-health.js（151 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFileHealth` | 38-150 | 113 | `export function checkFileHealth({ file, relPath, text, rules }) {` |
| `levelOf` | 87-90 | 4 | `const levelOf = (val, levels) => {` |

### lib/checks/filter.js（138 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `filterRulesByExt` | 32-50 | 19 | `export function filterRulesByExt(grouped, relPath) {` |
| `normRelPath` | 59-61 | 3 | `function normRelPath(s) {` |
| `includeHit` | 67-73 | 7 | `function includeHit(rel, inc) {` |
| `excludeHit` | 76-79 | 4 | `function excludeHit(rel, ex) {` |
| `filterRulesByPath` | 81-100 | 20 | `export function filterRulesByPath(grouped, relPath) {` |
| `filterRulesByFileText` | 118-137 | 20 | `export function filterRulesByFileText(grouped, text) {` |

### lib/checks/folder.js（174 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFolderRules` | 23-173 | 151 | `export function checkFolderRules({ root, rules, gitignoreText = '' }) {` |
| `isPackageDir` | 89-89 | 1 | `const isPackageDir = (d) => /\/src\/(?:main\|test\|androidTest)\/(?:java\|kotlin)\//.test(d.full)` |
| `isIgnored` | 148-148 | 1 | `const isIgnored = (p) => lines.some((l) => l === p \|\| l === p.replace(/^\*/, '') \|\| l.replace(/\/$/, '') === p);` |

### lib/checks/fs-scanner.js（58 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMultiFileScanners` | 21-57 | 37 | `export function checkMultiFileScanners(fileTexts = [], rules = null) {` |

### lib/checks/hardcoded-path.js（99 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hardcodedAbsPathHits` | 47-74 | 28 | `export function hardcodedAbsPathHits(text, filePath = '', baseDir = '') {` |
| `hardcodedAbsPathLines` | 77-79 | 3 | `export function hardcodedAbsPathLines(text, filePath = '', baseDir = '') {` |
| `hardcodedAbsPathDetail` | 82-90 | 9 | `export function hardcodedAbsPathDetail(text, filePath = '', baseDir = '') {` |
| `describeHardcodedAbsPath` | 93-98 | 6 | `export function describeHardcodedAbsPath(hit) {` |

### lib/checks/io.js（67 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkIoRisk` | 26-66 | 41 | `export function checkIoRisk({ file, text }) {` |

### lib/checks/magic-number.js（43 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkMagicNumberSmart` | 22-42 | 21 | `export function checkMagicNumberSmart({ file, text, rules }) {` |

### lib/checks/npm-json.js（274 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `starRangeDeps` | 21-33 | 13 | `function starRangeDeps(pkg) {` |
| `findJsonKeyLine` | 51-59 | 9 | `function findJsonKeyLine(text, key, valueHint) {` |
| `checkNpmJson` | 61-273 | 213 | `export function checkNpmJson({ file, text, rules, repoHasJsYamlImport, repoPath }) {` |

### lib/checks/private.js（65 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkPrivateFiles` | 25-64 | 40 | `export function checkPrivateFiles({ root, visibility = 'unknown', privateFiles = [] }) {` |

### lib/checks/regex.js（299 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `pickExemptHint` | 28-47 | 20 | `export function pickExemptHint(rule) {` |
| `hit` | 31-31 | 1 | `const hit = (words) => (Array.isArray(words) ? words : []).some((w) => id.includes(w));` |
| `checkRegexRules` | 58-221 | 164 | `export function checkRegexRules({ file, text, rules, source = '新增行', repoPath = '', treeConfirm = null }) {` |
| `inComment` | 94-101 | 8 | `const inComment = (line, col) => {` |
| `checkPathRegexRules` | 224-240 | 17 | `export function checkPathRegexRules({ file, relPath, rules }) {` |
| `checkBlacklist` | 250-298 | 49 | `export function checkBlacklist({ file, text, rules }) {` |

### lib/checks/scope-collision.js（69 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkScopeCollision` | 32-68 | 37 | `export function checkScopeCollision({ file, text, rules }) {` |

### lib/checks/semantic.js（135 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkSemantic` | 35-59 | 25 | `export function checkSemantic({ file, relPath, rules, repoLevelRules }) {` |
| `isRepoLevelSemanticRule` | 69-78 | 10 | `export function isRepoLevelSemanticRule(rule) {` |
| `checkPatchInsert` | 93-134 | 42 | `export function checkPatchInsert({ file, text, rules }) {` |

### lib/checks/structural.js（282 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `checkFuncLines` | 22-66 | 45 | `export function checkFuncLines({ file, text, rules }) {` |
| `checkSyncFsInFile` | 69-82 | 14 | `export function checkSyncFsInFile({ file, text }) {` |
| `checkEmptyCatch` | 85-98 | 14 | `export function checkEmptyCatch({ file, text }) {` |
| `checkMinLength` | 101-122 | 22 | `export function checkMinLength({ file, text, rules }) {` |
| `checkComplexity` | 125-151 | 27 | `export function checkComplexity({ file, text, rules }) {` |
| `checkDepth` | 154-170 | 17 | `export function checkDepth({ file, text, rules }) {` |
| `checkMaxLines` | 173-231 | 59 | `export function checkMaxLines({ file, text, rules, fileScope = '' }) {` |
| `checkCommentDensity` | 239-254 | 16 | `export function checkCommentDensity({ file, text, rules }) {` |
| `checkRepeated` | 257-281 | 25 | `export function checkRepeated({ file, text, rules }) {` |

### lib/config/load.js（175 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `configDirCandidates` | 56-64 | 9 | `export function configDirCandidates({ env = process.env, home = '' } = {}) {` |
| `resolveConfigFile` | 71-77 | 7 | `export function resolveConfigFile({ env = process.env, home = '' } = {}) {` |
| `configWriteTarget` | 80-83 | 4 | `export function configWriteTarget({ env = process.env, home = '' } = {}) {` |
| `legacyHostConfigFile` | 86-89 | 4 | `export function legacyHostConfigFile({ env = process.env } = {}) {` |
| `readJsonSafe` | 91-99 | 9 | `function readJsonSafe(file) {` |
| `sanitize` | 108-134 | 27 | `function sanitize(raw, sourceLabel, notes) {` |
| `loadConfig` | 141-174 | 34 | `export function loadConfig({ env = process.env, home = '' } = {}) {` |

### lib/core/atomic-json.js（99 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readJson` | 19-27 | 9 | `export function readJson(file) {` |
| `readJsonAny` | 34-41 | 8 | `export function readJsonAny(file) {` |
| `writeJsonAtomic` | 50-63 | 14 | `export function writeJsonAtomic(file, data, { mode = 0o600, pretty = true } = {}) {` |
| `updateJsonAtomic` | 72-76 | 5 | `export function updateJsonAtomic(file, updater, { mode = 0o600 } = {}) {` |
| `writeTextAtomic` | 86-98 | 13 | `export function writeTextAtomic(file, text, { mode = 0o600 } = {}) {` |

### lib/core/exec.js（125 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitSearchPlan` | 46-53 | 8 | `export function gitSearchPlan(pathValue, { delimiter = pathDelimiter, platform = process.platform } = {}) {` |
| `resolveGitBin` | 56-73 | 18 | `export function resolveGitBin() {` |
| `runGit` | 84-100 | 17 | `export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {` |
| `gitRaw` | 108-124 | 17 | `export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {` |

### lib/engine/analysis-coverage.js（99 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveEntries` | 30-40 | 11 | `async function resolveEntries({ repoPath, files }) {` |
| `computeAnalysisCoverage` | 48-68 | 21 | `export async function computeAnalysisCoverage({ repoPath = '', files = null, topN = DEFAULT_TOP_N } = {}) {` |
| `countByReason` | 71-75 | 5 | `function countByReason(unresolved) {` |
| `topUnresolvedFiles` | 78-85 | 8 | `function topUnresolvedFiles(unresolved, topN) {` |
| `formatAnalysisCoverageLine` | 92-98 | 7 | `export function formatAnalysisCoverageLine(cov = {}) {` |

### lib/engine/audit-file.js（207 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isMinifiedOneLine` | 32-42 | 11 | `function isMinifiedOneLine(text) {` |
| `isHashSegment` | 46-48 | 3 | `function isHashSegment(seg) {` |
| `isBuildArtifactFile` | 50-80 | 31 | `export function isBuildArtifactFile(relPathOrFile = '', text = '') {` |
| `auditFile` | 82-207 | 126 | `export function auditFile({ file, relPath, text, grouped }, opts = {}) {` |

### lib/engine/auditignore-rules.js（149 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseScopedLine` | 43-60 | 18 | `export function parseScopedLine(line) {` |
| `splitAuditIgnore` | 68-80 | 13 | `export function splitAuditIgnore(text = '') {` |
| `ruleMatches` | 83-91 | 9 | `export function ruleMatches(pattern, ruleId) {` |
| `matchScopedExemption` | 100-109 | 10 | `export function matchScopedExemption(scoped, relPath, ruleId) {` |
| `hasScopedEntries` | 112-114 | 3 | `export function hasScopedEntries(text = '') {` |
| `applyScopedExemptions` | 125-148 | 24 | `export function applyScopedExemptions(findings = [], root = '') {` |

### lib/engine/client-entry.js（94 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveDshClientEntries` | 27-54 | 28 | `export function resolveDshClientEntries(repoRoot) {` |
| `pick` | 40-48 | 9 | `const pick = (v) => {` |
| `resolveDshClientFragments` | 70-93 | 24 | `export function resolveDshClientFragments(repoRoot) {` |

### lib/engine/collector.js（610 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readIgnoreFileCached` | 71-77 | 7 | `function readIgnoreFileCached(p) {` |
| `isGitWorkTree` | 90-101 | 12 | `function isGitWorkTree(dir) {` |
| `auditIgnoreExcludesFile` | 110-125 | 16 | `function auditIgnoreExcludesFile(root, auditIgnorePath) {` |
| `tryLoadAuditIgnoreFallback` | 141-192 | 52 | `function tryLoadAuditIgnoreFallback(root, respectAuditIgnore = true) {` |
| `handleEntry` | 171-184 | 14 | `const handleEntry = (dir, en) => {` |
| `walkDirs` | 185-189 | 5 | `const walkDirs = (dir) => {` |
| `tryLoadGitIgnoreSet` | 204-301 | 98 | `function tryLoadGitIgnoreSet(root, respectAuditIgnore = true) {` |
| `walkDirs` | 245-260 | 16 | `const walkDirs = (dir) => {` |
| `isHardSkipped` | 310-312 | 3 | `function isHardSkipped(name) {` |
| `computeGitIgnored` | 315-320 | 6 | `function computeGitIgnored(full, gitIgnoreRoot, includeIgnored, respectAuditIgnore = true) {` |
| `shouldSkipDirByYml` | 323-327 | 5 | `function shouldSkipDirByYml(name, ignoredByGit, gitIgnoreRoot) {` |
| `isFileGitIgnored` | 330-341 | 12 | `function isFileGitIgnored(full, gitIgnoreRoot, includeIgnored, respectAuditIgnore = true) {` |
| `collectTextFiles` | 343-413 | 71 | `export async function collectTextFiles(dir, { depth = 10, gitIgnoreRoot = null, includeIgnored = false, testExemptRoot = null, respectAuditIgnore = true } = {}) {` |
| `walk` | 376-412 | 37 | `async function walk(cur, level) {` |
| `gitListTextFiles` | 424-486 | 63 | `function gitListTextFiles(dir, { gitIgnoreRoot = null, includeIgnored = false, testExemptRoot = null, respectAuditIgnore = true } = {}) {` |
| `isGitRepo` | 489-491 | 3 | `export function isGitRepo(dir) {` |
| `collectChangedFiles` | 499-556 | 58 | `export function collectChangedFiles(repoPath) {` |
| `isTextFile` | 559-577 | 19 | `export function isTextFile(full) {` |
| `clearReadCache` | 591-594 | 4 | `export function clearReadCache() {` |
| `readText` | 597-610 | 14 | `export function readText(full) {` |

### lib/engine/ext-runner.js（80 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadAuditExt` | 28-51 | 24 | `export async function loadAuditExt(dir = DEFAULT_EXT_DIR) {` |
| `runAuditExt` | 59-80 | 22 | `export async function runAuditExt(repo, opts = {}) {` |

### lib/engine/file-context.js（392 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasMkdirInSameFunction` | 19-48 | 30 | `export function hasMkdirInSameFunction(lines, lineIdx) {` |
| `enclosingScopes` | 55-63 | 9 | `function enclosingScopes(lines, lineIdx) {` |
| `topLevelFunctionScope` | 69-392 | 324 | `function topLevelFunctionScope(lines, lineIdx) {` |
| `isBestEffortWrite` | 99-120 | 22 | `export function isBestEffortWrite(lines, lineIdx) {` |
| `functionScope` | 123-392 | 270 | `function functionScope(lines, lineIdx) {` |
| `stripBracesNoise` | 167-173 | 7 | `function stripBracesNoise(line) {` |
| `mkdirHelperNames` | 176-198 | 23 | `function mkdirHelperNames(lines) {` |
| `hasForeignWriteTarget` | 222-247 | 26 | `export function hasForeignWriteTarget(lines, lineIdx) {` |
| `enclosingParams` | 257-262 | 6 | `function enclosingParams(lines, lineIdx) {` |
| `hasTimeoutInRange` | 315-320 | 6 | `function hasTimeoutInRange(lines, start, end) {` |
| `isCallClosed` | 323-324 | 2 | `function isCallClosed(s, depth) {` |
| `hasTimeoutAfterCall` | 337-347 | 11 | `function hasTimeoutAfterCall(line, lines, lineIdx) {` |
| `hasExternalCallTimeout` | 349-354 | 6 | `export function hasExternalCallTimeout(line, lines, lineIdx) {` |
| `detectRepoJsYamlImport` | 363-372 | 10 | `export function detectRepoJsYamlImport(files) {` |
| `isVersionInPathContext` | 385-391 | 7 | `export function isVersionInPathContext(line) {` |

### lib/engine/finding.js（102 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isBlockerFinding` | 11-14 | 4 | `export function isBlockerFinding(f) {` |
| `makeFinding` | 18-20 | 3 | `export function makeFinding({ file, line, rule, kind, severity = 'warning', message, dimensions = [], exemptHint = '', scoreImpact = 0 }) {` |
| `normalizeExemptHints` | 36-47 | 12 | `export function normalizeExemptHints(findings = []) {` |
| `decorateTestExemptHint` | 57-68 | 12 | `export function decorateTestExemptHint(findings = []) {` |
| `summarize` | 81-91 | 11 | `export function summarize(findings = []) {` |

### lib/engine/gitignore-match.js（114 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseGitignore` | 33-52 | 20 | `export function parseGitignore(text) {` |
| `compilePattern` | 63-71 | 9 | `function compilePattern(pattern, anchored) {` |
| `isIgnoredByRules` | 85-102 | 18 | `export function isIgnoredByRules(rules, relPath, isDir = false) {` |
| `isIgnored` | 111-113 | 3 | `export function isIgnored(text, relPath, isDir = false) {` |

### lib/engine/glob.js（63 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `globToRegex` | 9-63 | 55 | `export function globToRegex(glob, anchored = true) {` |
| `globMatch` | 60-63 | 4 | `export function globMatch(glob, path) {` |

### lib/engine/history-report.js（100 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `resolveReportDir` | 18-20 | 3 | `export function resolveReportDir(repoPath, outDir = '') {` |
| `renderMarkdown` | 23-53 | 31 | `function renderMarkdown(entry = {}) {` |
| `writeCommitReport` | 61-70 | 10 | `export function writeCommitReport(dir, entry = {}) {` |
| `writeHistoryIndex` | 77-100 | 24 | `export function writeHistoryIndex(dir, meta = {}) {` |

### lib/engine/history.js（127 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `listHistoryCommits` | 32-54 | 23 | `export function listHistoryCommits(repoPath, { since = '', until = '' } = {}) {` |
| `auditHistoryCommit` | 64-87 | 24 | `export async function auditHistoryCommit(repoPath, commit, opts = {}, weights = {}) {` |
| `runHistoryAudit` | 95-127 | 33 | `export async function runHistoryAudit(repoPath, { since = '', until = '', outDir = '', auditOpts = {}, weights = {}, signal, onCommit } = {}) {` |

### lib/engine/ignore-blind.js（103 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `excludePathOf` | 39-48 | 10 | `function excludePathOf(root) {` |
| `detectIgnoreBlindSpot` | 55-102 | 48 | `export function detectIgnoreBlindSpot(root) {` |

### lib/engine/orchestrate.js（673 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setHostDocChecks` | 32-34 | 3 | `export function setHostDocChecks(checks) {` |
| `findMarkedHostMd` | 38-38 | 1 | `const findMarkedHostMd = (...args) => (injected \|\| EMPTY_DOC_CHECKS).findMarkedHostMd(...args);` |
| `checkDrift` | 39-39 | 1 | `const checkDrift = (...args) => (injected \|\| EMPTY_DOC_CHECKS).checkDrift(...args);` |
| `checkFuncDrift` | 40-40 | 1 | `const checkFuncDrift = (...args) => (injected \|\| EMPTY_DOC_CHECKS).checkFuncDrift(...args);` |
| `capScanFiles` | 61-71 | 11 | `export function capScanFiles(files, root, maxFiles) {` |
| `appendIgnoreBlindSpot` | 84-100 | 17 | `function appendIgnoreBlindSpot(findings, repoPath, scanned) {` |
| `buildTreeConfirmer` | 132-158 | 27 | `async function buildTreeConfirmer(relPath, text, grouped) {` |
| `computeDimFileCounts` | 179-213 | 35 | `export function computeDimFileCounts(grouped, normFiles) {` |
| `computeDimRuleCounts` | 226-238 | 13 | `export function computeDimRuleCounts(grouped) {` |
| `auditFiles` | 240-464 | 225 | `async function auditFiles(repoPath, files, opts = {}) {` |
| `isDshPlugin` | 265-271 | 7 | `const isDshPlugin = (() => {` |
| `auditFull` | 466-488 | 23 | `export async function auditFull(repoPath, opts = {}) {` |
| `appendTreeDocDrift` | 493-535 | 43 | `function appendTreeDocDrift(findings, repoPath) {` |
| `by` | 526-526 | 1 | `const by = (code) => wt.filter(([, v]) => v?.status === code).length;` |
| `appendFuncDocDrift` | 544-560 | 17 | `function appendFuncDocDrift(findings, repoPath) {` |
| `appendSplitDocsCheck` | 568-622 | 55 | `function appendSplitDocsCheck(findings, repoPath) {` |
| `hasMarkBlock` | 625-627 | 3 | `function hasMarkBlock(text, marker) {` |
| `auditChanged` | 632-667 | 36 | `export async function auditChanged(repoPath, opts = {}) {` |
| `isAuditIgnored` | 648-661 | 14 | `const isAuditIgnored = (rel) => {` |
| `auditWithScope` | 670-672 | 3 | `export async function auditWithScope(repoPath, { scope = 'diff', ...opts } = {}) {` |

### lib/engine/ownership.js（47 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `classifyOwnership` | 27-32 | 6 | `export function classifyOwnership(login = '', owner = '') {` |
| `privacyRulesEnabled` | 39-41 | 3 | `export function privacyRulesEnabled(ownership) {` |
| `isPrivacyRule` | 44-46 | 3 | `export function isPrivacyRule(ruleId) {` |

### lib/engine/repo-level.js（31 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `repoLevelSemanticRuleIds` | 10-16 | 7 | `export function repoLevelSemanticRuleIds(grouped = {}) {` |
| `pickRepoLevelAnchorFile` | 24-30 | 7 | `export function pickRepoLevelAnchorFile(files = []) {` |

### lib/engine/report-yaml.js（90 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `findingsToYaml` | 32-81 | 50 | `export function findingsToYaml(findings = [], { includeMessage = true, maxMessageLen = 200 } = {}) {` |
| `countSeverity` | 84-90 | 7 | `function countSeverity(dirMap) {` |

### lib/engine/scope-policy.js（111 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normRelPath` | 28-30 | 3 | `function normRelPath(value) {` |
| `findConfigPath` | 44-58 | 15 | `function findConfigPath(startDir, now) {` |
| `readProjectScopePolicy` | 74-110 | 37 | `export function readProjectScopePolicy(file = '') {` |

### lib/engine/score-spec.js（71 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getBuiltinScoreSpec` | 41-49 | 9 | `export function getBuiltinScoreSpec() {` |
| `validateScoreSpec` | 59-70 | 12 | `export function validateScoreSpec(scoreSpec) {` |

### lib/engine/slot-stats.js（36 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setLastSlotHitStats` | 20-25 | 6 | `export function setLastSlotHitStats(stats, repo = '') {` |
| `getLastSlotHitStats` | 28-30 | 3 | `export function getLastSlotHitStats() {` |
| `getLastSlotHitMeta` | 33-35 | 3 | `export function getLastSlotHitMeta() {` |

### lib/engine/slot.js（67 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `slotStatsFromFindings` | 17-46 | 30 | `export function slotStatsFromFindings(findings = [], ruleSlotMap = new Map(), slotRuleCount = {}) {` |
| `ensure` | 26-29 | 4 | `const ensure = (slot) => {` |
| `buildRuleSlotMap` | 49-56 | 8 | `export function buildRuleSlotMap(compiledRules = []) {` |
| `countRulesBySlot` | 59-66 | 8 | `export function countRulesBySlot(compiledRules = []) {` |

### lib/exempt/index.js（347 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hasHeaderExempt` | 126-130 | 5 | `export function hasHeaderExempt(text, marker) {` |
| `hasLineExempt` | 133-135 | 3 | `export function hasLineExempt(line, marker) {` |
| `isCategoryExempt` | 153-161 | 9 | `export function isCategoryExempt(finding = {}) {` |
| `markerCovers` | 170-189 | 20 | `function markerCovers(meta, kind, rule) {` |
| `has` | 173-173 | 1 | `const has = (a) => Array.isArray(a) && a.length > 0;` |
| `exemptMarkerCovers` | 192-194 | 3 | `export function exemptMarkerCovers(marker, finding = {}) {` |
| `exemptHintForFinding` | 202-212 | 11 | `export function exemptHintForFinding(finding = {}) {` |
| `exemptForFinding` | 223-240 | 18 | `export function exemptForFinding(finding, text = '') { // dsh-skip-complexity: 豁免判定器本体（9 标记 × blocked/细分规则多条件链，职责单一）` |
| `exemptHintFor` | 243-248 | 6 | `export function exemptHintFor(ruleOrKind) {` |
| `cacheGet` | 264-265 | 2 | `function cacheGet(cache, dir) { return cache.has(dir) ? cache.get(dir) : undefined; }` |
| `dirHasEmptyMarker` | 267-279 | 13 | `function dirHasEmptyMarker(dir, name, cache) {` |
| `clearExemptMarkerCache` | 282-285 | 4 | `export function clearExemptMarkerCache() {` |
| `isSampleExemptDir` | 296-316 | 21 | `export function isSampleExemptDir(repoPath, relPath = '') {` |
| `isTestExemptDir` | 326-346 | 21 | `export function isTestExemptDir(repoPath, relPath = '') {` |

### lib/exempt/tool.js（199 行 · 11 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `findRuleKind` | 23-31 | 9 | `async function findRuleKind(repoPath, ruleId) {` |
| `readText` | 34-36 | 3 | `function readText(file) {` |
| `resolveTarget` | 39-47 | 9 | `function resolveTarget(repoPath, p) {` |
| `resolveMarker` | 50-76 | 27 | `function resolveMarker({ rule = '', marker = '', scope = '', kind = '' }) {` |
| `hasMarker` | 79-84 | 6 | `function hasMarker(lines, marker, scope, line) {` |
| `headerComment` | 87-89 | 3 | `function headerComment(marker, reason) {` |
| `addExempt` | 95-138 | 44 | `export async function addExempt({ repoPath = '', path: p, line, scope = '', rule = '', marker = '', reason = '', dryRun = false } = {}) {` |
| `removeExempt` | 141-158 | 18 | `export function removeExempt({ repoPath = '', path: p, marker = '', dryRun = false } = {}) {` |
| `listExempt` | 161-185 | 25 | `export function listExempt({ repoPath = '', root = '' } = {}) {` |
| `walk` | 164-182 | 19 | `const walk = (dir, depth) => {` |
| `checkExempt` | 188-198 | 11 | `export function checkExempt({ repoPath = '', root = '' } = {}) {` |

### lib/host-doc-checks.js（26 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `installHostDocChecks` | 20-23 | 4 | `export function installHostDocChecks(checks = HOST_DOC_CHECKS) {` |

### lib/index.js（176 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `assertRepoPath` | 60-68 | 9 | `export function assertRepoPath(repoPath) {` |
| `isInsideGitWorkTree` | 79-86 | 8 | `export function isInsideGitWorkTree(repoPath) {` |
| `audit` | 107-172 | 66 | `export async function audit(options = {}) {` |

### lib/link-check/index.js（187 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isFlakyHost` | 43-46 | 4 | `export function isFlakyHost(host = '') {` |
| `extractLinks` | 53-65 | 13 | `export function extractLinks(text = '') {` |
| `gradeResult` | 75-104 | 30 | `export function gradeResult(url = '', r = {}) {` |
| `probeLink` | 112-129 | 18 | `export async function probeLink(url, { timeoutMs = DEFAULT_OPTS.timeoutMs, fetcher } = {}) {` |
| `probeLinks` | 137-151 | 15 | `export async function probeLinks(links = [], { concurrency = DEFAULT_OPTS.concurrency, timeoutMs = DEFAULT_OPTS.timeoutMs, fetcher } = {}) {` |
| `checkLinks` | 158-182 | 25 | `export async function checkLinks({ file = '', text = '', fetcher, concurrency, timeoutMs, maxLinks = DEFAULT_OPTS.maxLinks } = {}) {` |
| `sumLinkPenalty` | 185-187 | 3 | `export function sumLinkPenalty(findings = []) {` |

### lib/lint-adapter/detect.js（162 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isExecutable` | 37-47 | 11 | `function isExecutable(p) {` |
| `hasConfig` | 50-63 | 14 | `function hasConfig(repoRoot, linter) {` |
| `resolveBin` | 71-76 | 6 | `export function resolveBin(repoRoot, linter) {` |
| `tryWhich` | 79-90 | 12 | `function tryWhich(bin) {` |
| `detectLinters` | 96-98 | 3 | `export function detectLinters(repoRoot) {` |
| `detectLinterStatus` | 110-120 | 11 | `export function detectLinterStatus(repoRoot) {` |
| `binCandidates` | 123-135 | 13 | `function binCandidates(repoRoot, linter) {` |
| `resolveBinDetailed` | 138-151 | 14 | `function resolveBinDetailed(repoRoot, linter) {` |
| `tryVersion` | 154-161 | 8 | `function tryVersion(bin) {` |

### lib/lint-adapter/index.js（51 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runLintAdapters` | 19-48 | 30 | `export async function runLintAdapters(repoRoot, opts = {}) {` |

### lib/lint-adapter/runner.js（134 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ruffDims` | 39-43 | 5 | `function ruffDims(code) {` |
| `ruffItemToFinding` | 49-66 | 18 | `export function ruffItemToFinding(item, repoRoot) {` |
| `relFile` | 69-78 | 10 | `function relFile(abs, repoRoot) {` |
| `parseRuffJson` | 81-90 | 10 | `function parseRuffJson(stdout) {` |
| `runLinter` | 98-133 | 36 | `export async function runLinter(linter, repoRoot) {` |

### lib/manifest.js（105 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getPreprocessManifest` | 102-104 | 3 | `export function getPreprocessManifest() {` |

### lib/preprocess/adapters/builtin.js（93 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getAdapter` | 87-92 | 6 | `export function getAdapter(adapterId) {` |

### lib/preprocess/api-guide.js（72 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `detectHostIp` | 19-30 | 12 | `function detectHostIp() {` |
| `buildAuditApiGuide` | 39-71 | 33 | `export function buildAuditApiGuide(repo = '', opts = {}) {` |

### lib/preprocess/audit.js（109 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditPreprocessAvailable` | 49-55 | 7 | `export function auditPreprocessAvailable(cfg = {}, hasBuiltinEngine) {` |
| `formatBlocked` | 70-76 | 7 | `function formatBlocked(blocked = []) {` |
| `auditRenderResult` | 87-100 | 14 | `export function auditRenderResult(ctx = {}) {` |

### lib/preprocess/exempt.js（248 行 · 10 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `getEngineAdapter` | 55-59 | 5 | `export function getEngineAdapter(engineId = 'builtin') {` |
| `linesOf` | 62-64 | 3 | `function linesOf(text = '') {` |
| `sourceMarkerExempts` | 79-112 | 34 | `export function sourceMarkerExempts(engineId, text = '', finding = {}, adapterProfile) {` |
| `at` | 94-94 | 1 | `const at = (idx) => String(lines[idx] \|\| '');` |
| `declaredExempts` | 124-136 | 13 | `export function declaredExempts(suppressed = [], finding = {}) {` |
| `normalize` | 126-126 | 1 | `const normalize = (value) => String(value \|\| '').replace(/\\/g, '/').replace(/^\.\//, '');` |
| `exemptionOf` | 150-194 | 45 | `export function exemptionOf(finding = {}, opts = {}) {` |
| `resolveExemptions` | 206-217 | 12 | `export function resolveExemptions(findings = [], opts = {}) {` |
| `filterExempted` | 225-227 | 3 | `export function filterExempted(findings = [], opts = {}) {` |
| `loadIgnoreFingerprints` | 238-247 | 10 | `export function loadIgnoreFingerprints(repoPath = '.', fileName = '.gitleaksignore') {` |

### lib/preprocess/index.js（143 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `preprocessParams` | 39-47 | 9 | `export function preprocessParams(cfg = {}, hasBuiltinEngine, preprocessors = PREPROCESSORS) {` |
| `runPreprocess` | 68-108 | 41 | `export async function runPreprocess(repoPath, opts = {}) {` |
| `renderPreprocessResult` | 123-142 | 20 | `export function renderPreprocessResult(ctx = {}, cfg = {}, preprocessors = PREPROCESSORS) {` |

### lib/preprocess/score.js（125 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `fallbackDimOfRule` | 55-59 | 5 | `export function fallbackDimOfRule(rule) {` |
| `resolveWeights` | 69-77 | 9 | `export function resolveWeights(scoreSpec, userWeights = {}) {` |
| `fillMissingDimensions` | 88-96 | 9 | `export function fillMissingDimensions(findings = [], scoreSpec = getBuiltinScoreSpec()) {` |
| `score` | 108-124 | 17 | `export function score(findings = [], scoreSpec = getBuiltinScoreSpec(), userWeights = {}, context = {}) {` |

### lib/report.js（73 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `exemptStatsOf` | 29-53 | 25 | `export function exemptStatsOf(findings = []) {` |
| `blockedOf` | 65-72 | 8 | `export function blockedOf(findings = [], { compact = true } = {}) {` |

### lib/rule/compilers/helpers.js（72 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `safeRe` | 16-27 | 12 | `export function safeRe(pattern, label, errors = []) {` |
| `pickDimensions` | 43-53 | 11 | `export function pickDimensions(r = {}, fallback = [], errors = []) {` |
| `ruleOut` | 56-69 | 14 | `export function ruleOut({ id, name, kind, severity = 'warning', level = 'warning', message, pattern, patterns, pathPattern, threshold, dimensions = [], extra = {} }) {` |

### lib/rule/compilers/list-kinds.js（13 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `listRegisteredKinds` | 9-12 | 4 | `export function listRegisteredKinds() {` |

### lib/rule/homoglyph.js（46 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `findHomoglyphs` | 32-40 | 9 | `export function findHomoglyphs(text) {` |
| `hasHomoglyphs` | 43-45 | 3 | `export function hasHomoglyphs(text) {` |

### lib/rule/loader.js（274 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isForceLoadRule` | 48-50 | 3 | `export function isForceLoadRule(ruleId) {` |
| `loadYamlRuleFile` | 98-107 | 10 | `export function loadYamlRuleFile(slot, dir = RULE_YAML_DIR) {` |
| `discoverRuleSlots` | 112-120 | 9 | `export function discoverRuleSlots(dir = RULE_YAML_DIR) {` |
| `resolveSlotOrder` | 135-166 | 32 | `export function resolveSlotOrder(order = null, { dir = RULE_YAML_DIR, includeTemplate = false } = {}) {` |
| `push` | 148-156 | 9 | `const push = (slot) => {` |
| `loadRuleFiles` | 177-226 | 50 | `export function loadRuleFiles(order = null, opts = {}) {` |
| `setSlotDisabled` | 240-274 | 35 | `export function setSlotDisabled(slot, disabled, opts = {}) {` |

### lib/rule/registry.js（122 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `registerCompiler` | 18-20 | 3 | `export function registerCompiler(kind, detect, compile) {` |
| `compileRule` | 28-61 | 34 | `export function compileRule(rule, ctx = {}) {` |
| `withSlot` | 43-51 | 9 | `const withSlot = (res) => {` |
| `compileAllRules` | 64-72 | 9 | `export function compileAllRules(rules, ctx = {}) {` |
| `withRuleScope` | 89-122 | 34 | `function withRuleScope(compiled, source) {` |

### lib/rule/scope.js（67 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `normalizeScopeRules` | 35-44 | 10 | `export function normalizeScopeRules(rule) {` |
| `resolveScopeAction` | 52-67 | 16 | `export function resolveScopeAction(scopeRules, scopeInfo = {}) {` |

### lib/scope-check.js（70 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `policyForFile` | 28-30 | 3 | `export function policyForFile(file) {` |
| `runScopeCheck` | 38-69 | 32 | `export function runScopeCheck({ files = [], prefix = '', allowlist = [], topLevelMustBeEmpty } = {}) {` |

### lib/score/docs-score.js（166 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectDocFiles` | 45-69 | 25 | `export function collectDocFiles(root = '.') {` |
| `walk` | 54-63 | 10 | `const walk = (dir) => {` |
| `checkDocsScore` | 84-153 | 70 | `export function checkDocsScore(root = '.') { // dsh-skip-func-length dsh-skip-complexity: 文档加分判定器（四检查链 + 宿主版本比对多条件，职责单一；53 行/24 复杂度为结构必然）` |
| `maxVersion` | 156-166 | 11 | `function maxVersion(list) {` |
| `cmp` | 157-164 | 8 | `const cmp = (a, b) => {` |

### lib/score/index.js（234 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countByDimension` | 50-82 | 33 | `export function countByDimension(findings = []) {` |
| `countHitFilesByDimension` | 92-107 | 16 | `export function countHitFilesByDimension(findings = []) {` |
| `scoreQuality` | 127-234 | 108 | `export function scoreQuality(findings = [], weights = {}, context = {}) {` |
| `ruleCountOf` | 184-188 | 5 | `const ruleCountOf = (dim) => {` |
| `denomOf` | 193-196 | 4 | `const denomOf = (dim) => {` |
| `dynamicRatio` | 199-208 | 10 | `const dynamicRatio = (dim) => {` |

### lib/shared/tokenizer.js（422 行 · 14 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `tokenize` | 49-70 | 22 | `export function tokenize(text = '') {` |
| `clearTokenCache` | 73-76 | 4 | `export function clearTokenCache() {` |
| `tokenizeUncached` | 83-195 | 113 | `function tokenizeUncached(text = '') {` |
| `MULTI_OPS_BY_FIRST` | 207-215 | 9 | `const MULTI_OPS_BY_FIRST = (() => {` |
| `isCjkChar` | 232-232 | 1 | `const isCjkChar = (c) => c >= 0x4e00 && c <= 0x9fa5;` |
| `isIdentStartCode` | 234-234 | 1 | `const isIdentStartCode = (c) => (c < 128 ? ID_START_ASCII[c] === 1 : isCjkChar(c));` |
| `isIdentPartCode` | 236-236 | 1 | `const isIdentPartCode = (c) => (c < 128 ? ID_PART_ASCII[c] === 1 : isCjkChar(c));` |
| `isNumPartCode` | 238-238 | 1 | `const isNumPartCode = (c) => c < 128 && NUM_PART_ASCII[c] === 1;` |
| `isAsciiDigit` | 240-240 | 1 | `const isAsciiDigit = (c) => c >= 48 && c <= 57;` |
| `consumeLexeme` | 251-293 | 43 | `function consumeLexeme(src, i, n, ch, next, tokens, push) { // dsh-skip-complexity: 词素分派器（六类词素分派分支为结构必然，拆分后职责单一）` |
| `consumeCsharpInterpolated` | 311-360 | 50 | `function consumeCsharpInterpolated(src, i, n, push) { // dsh-skip-complexity: 三前缀组合 + 洞内嵌套串 + verbatim 转义` |
| `consumeString` | 363-374 | 12 | `function consumeString(src, i, n, ch, push) {` |
| `consumeTemplate` | 377-388 | 12 | `function consumeTemplate(src, i, n, push) {` |
| `consumeRegex` | 391-396 | 6 | `function consumeRegex(src, i, n, tokens, push) { // dsh-skip-complexity: 正则状态机（转义/字符组/闭包三态，天然多分支）` |

### lib/skip-dirs.js（68 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditRulesDir` | 28-30 | 3 | `export function auditRulesDir() {` |
| `loadYamlBlacklistDirs` | 38-57 | 20 | `export function loadYamlBlacklistDirs() {` |
| `getSkipSet` | 63-67 | 5 | `export function getSkipSet() {` |

### scripts/audit-ext/dsh-inject-declarations.mjs（210 行 · 7 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isPluginEntry` | 55-58 | 4 | `function isPluginEntry(text) {` |
| `collectFiles` | 61-79 | 19 | `function collectFiles(repo) {` |
| `walk` | 63-76 | 14 | `const walk = (dir) => {` |
| `declaredInjectNames` | 85-103 | 19 | `function declaredInjectNames(text) {` |
| `stripTrailingComment` | 106-129 | 24 | `function stripTrailingComment(line) {` |
| `ctxServiceNotInjectedHits` | 132-155 | 24 | `function ctxServiceNotInjectedHits(text) {` |
| `defaultExportConflictLine` | 158-169 | 12 | `function defaultExportConflictLine(text) {` |

### scripts/audit-ext/variable-min-length.mjs（102 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isExcludedPath` | 29-36 | 8 | `const isExcludedPath = (rel) => {` |
| `walk` | 60-98 | 39 | `const walk = (dir) => {` |

### scripts/doc-func.mjs（213 行 · 12 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `escapeReg` | 30-31 | 2 | `function escapeReg(s) { return s.replace(/[.*+?^${}()\|[\]\\]/g, '\\$&'); }` |
| `stripComment` | 32-34 | 3 | `function stripComment(line) {` |
| `findBlockEnd` | 37-49 | 13 | `function findBlockEnd(lines, startIdx) {` |
| `detectFunction` | 51-60 | 10 | `function detectFunction(lines, i) {` |
| `scanFileFuncs` | 63-213 | 151 | `export function scanFileFuncs(file, textOverride) {` |
| `collectFuncFiles` | 111-126 | 16 | `export function collectFuncFiles(root, includeDirs = DEFAULT_SCAN_DIRS) {` |
| `walk` | 113-123 | 11 | `const walk = (dir, depth) => {` |
| `buildFuncListText` | 129-148 | 20 | `export function buildFuncListText(root, includeDirs = DEFAULT_SCAN_DIRS) {` |
| `findBlock` | 151-156 | 6 | `function findBlock(text) {` |
| `applyFuncBlock` | 159-163 | 5 | `export function applyFuncBlock(text, newContent) {` |
| `checkFuncDrift` | 166-178 | 13 | `export function checkFuncDrift({ hostPath, root, includeDirs = DEFAULT_SCAN_DIRS } = {}) {` |
| `out` | 188-188 | 1 | `const out = (msg) => console.log(msg);` |

### scripts/doc-tree.mjs（458 行 · 20 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `collectMdFiles` | 52-68 | 17 | `function collectMdFiles(root) {` |
| `walk` | 55-65 | 11 | `const walk = (dir, depth) => {` |
| `findMarkedHostMd` | 78-87 | 10 | `export function findMarkedHostMd(root, marker = 'dshgp-tree') {` |
| `resolveTargetMd` | 90-93 | 4 | `export function resolveTargetMd(root, explicit = '', marker = 'dshgp-tree') {` |
| `gitLsFiles` | 101-114 | 14 | `function gitLsFiles(root = ROOT) {` |
| `loadMapping` | 118-122 | 5 | `function loadMapping(root = ROOT) {` |
| `writeMapping` | 124-126 | 3 | `function writeMapping(map, root = ROOT) {` |
| `gitWorktreeChanges` | 134-156 | 23 | `function gitWorktreeChanges(root = ROOT) {` |
| `syncIndex` | 166-211 | 46 | `export function syncIndex({ write = true, files = gitLsFiles(), map = loadMapping(), root = ROOT } = {}) {` |
| `buildGroups` | 216-232 | 17 | `function buildGroups(files) {` |
| `groupLines` | 235-261 | 27 | `function groupLines(name, paths, map, prefix = '') {` |
| `note` | 249-249 | 1 | `const note = (p) => (map[p] ? map[p] : '（待注释）');` |
| `buildTreeText` | 264-276 | 13 | `export function buildTreeText(files = gitLsFiles(), map = loadMapping(), rootLabel = basename(ROOT)) {` |
| `findBlock` | 281-288 | 8 | `function findBlock(text, marker = 'dshgp-tree') {` |
| `readReadme` | 290-293 | 4 | `function readReadme(path) {` |
| `applyBlock` | 295-299 | 5 | `function applyBlock(text, newTree) {` |
| `checkDrift` | 303-383 | 81 | `export function checkDrift({ readmePath = '', root = ROOT } = {}) {` |
| `isToolGenerated` | 354-354 | 1 | `const isToolGenerated = (p) => p === 'functions-index.json' \|\| p === '_meta'` |
| `filesOf` | 402-402 | 1 | `const filesOf = (r) => gitLsFiles(r);` |
| `mapOf` | 403-403 | 1 | `const mapOf = (r) => loadMapping(r);` |

### scripts/doc-version.mjs（150 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `packageVersionOf` | 40-42 | 3 | `export function packageVersionOf(root) {` |
| `buildVersionListText` | 46-51 | 6 | `export function buildVersionListText(root, _opts = {}) {` |
| `findBlock` | 54-59 | 6 | `function findBlock(text) {` |
| `applyVersionBlock` | 62-66 | 5 | `export function applyVersionBlock(text, newContent) {` |
| `checkVersionDrift` | 69-77 | 9 | `export function checkVersionDrift({ hostPath, root, versionSource = '' } = {}) {` |
| `out` | 94-94 | 1 | `const out = (msg) => console.log(msg);` |

### scripts/hot-path-probe.mjs（154 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readCfg` | 31-37 | 7 | `function readCfg() {` |
| `report` | 61-77 | 17 | `function report() {` |
| `initialize` | 88-90 | 3 | `export function initialize(data) {` |
| `resolve` | 93-102 | 10 | `export async function resolve(specifier, context, next) {` |
| `load` | 105-153 | 49 | `export async function load(url, context, next) {` |
| `__wrapped` | 141-145 | 5 | `const __wrapped = function (...__a) {` |

### scripts/scan-file-io.mjs（718 行 · 27 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `isFnSignature` | 116-469 | 354 | `function isFnSignature(s) {` |
| `stripCommentLines` | 129-153 | 25 | `function stripCommentLines(lines, uptoIdx) {` |
| `scanEnclosure` | 156-173 | 18 | `function scanEnclosure(lines, lineIdx) {` |
| `inRequestPath` | 181-194 | 14 | `function inRequestPath(lines, lineIdx) {` |
| `contextAt` | 197-200 | 4 | `function contextAt(lines, lineIdx) {` |
| `ioTypeOf` | 203-205 | 3 | `function ioTypeOf(opName = '') {` |
| `collectFiles` | 213-231 | 19 | `function collectFiles(targets) {` |
| `walk` | 215-228 | 14 | `const walk = (p) => {` |
| `isRegexStart` | 248-254 | 7 | `function isRegexStart(out, next) {` |
| `advanceInsideState` | 268-287 | 20 | `function advanceInsideState(line, i, st) {` |
| `stripLiterals` | 289-310 | 22 | `function stripLiterals(line) {` |
| `scanFile` | 316-364 | 49 | `function scanFile(file) {` |
| `riskOfFallback` | 377-384 | 8 | `function riskOfFallback(entry, ctx) {` |
| `riskOfByAst` | 397-410 | 14 | `function riskOfByAst(astHits, line, op, entry, ctx) {` |
| `collectVarAssignments` | 413-427 | 15 | `function collectVarAssignments(lines) {` |
| `extractArg` | 430-454 | 25 | `function extractArg(line, op, opName) {` |
| `resolvePathArg` | 457-463 | 7 | `function resolvePathArg(arg, varMap, lineIdx) {` |
| `tagsOf` | 474-480 | 7 | `function tagsOf(h) {` |
| `riskMark` | 483-485 | 3 | `function riskMark(risk) {` |
| `printText` | 492-517 | 26 | `function printText(hits, { writeOnly = false, riskOnly = '', summary = false } = {}) {` |
| `printJson` | 520-522 | 3 | `function printJson(hits) {` |
| `main` | 530-580 | 51 | `export function main(argv = process.argv.slice(2)) {` |
| `splitMulti` | 541-541 | 1 | `const splitMulti = (v) => String(v \|\| '').split(',').map((x) => x.trim()).filter(Boolean);` |
| `scanFileIo` | 583-604 | 22 | `export function scanFileIo(opts = {}) {` |
| `summarize` | 607-624 | 18 | `export function summarize(hits) {` |
| `count` | 608-612 | 5 | `const count = (key) => {` |
| `printReport` | 636-712 | 77 | `function printReport(hits, opts = {}) {` |

### scripts/scan-fs-hotspots.mjs（108 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseArgs` | 31-43 | 13 | `function parseArgs(argv) {` |
| `collectFiles` | 46-67 | 22 | `function collectFiles(dir, o, out = []) {` |

### scripts/scan-version.mjs（126 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `readmeVersion` | 36-66 | 31 | `export function readmeVersion(text = '') {` |
| `cmp` | 56-63 | 8 | `const cmp = (a, b) => {` |
| `main` | 68-123 | 56 | `function main() {` |

### scripts/version-source.mjs（174 行 · 9 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runGit` | 16-23 | 8 | `function runGit(args, { cwd = '' } = {}) {` |
| `parseVersion` | 30-34 | 5 | `export function parseVersion(str) {` |
| `listVersionCommits` | 39-53 | 15 | `export function listVersionCommits(repoPath) {` |
| `scrubConvWording` | 60-74 | 15 | `export function scrubConvWording(label) {` |
| `readVersionMetrics` | 85-92 | 8 | `export function readVersionMetrics(repoPath) {` |
| `detectVersionSource` | 105-110 | 6 | `export function detectVersionSource(root) {` |
| `projectVersionOf` | 113-123 | 11 | `export function projectVersionOf(root, source = '') {` |
| `readReleases` | 126-133 | 8 | `export function readReleases(repoPath) {` |
| `buildReadmeVersionTable` | 151-171 | 21 | `export function buildReadmeVersionTable(repoPath) {` |

### test/helpers/tmp-dir.mjs（117 行 · 6 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `installExitHook` | 25-33 | 9 | `function installExitHook() {` |
| `removeTempDir` | 36-39 | 4 | `export function removeTempDir(dir) {` |
| `mkdtempTracked` | 51-57 | 7 | `export function mkdtempTracked(prefixPath) {` |
| `tempDir` | 65-71 | 7 | `export function tempDir(label = 'tmp', { t = null } = {}) {` |
| `tempRepo` | 79-85 | 7 | `export function tempRepo(label = 'repo', { t = null, name = '', email = '' } = {}) {` |
| `sweepStaleTempDirs` | 93-116 | 24 | `export function sweepStaleTempDirs({ maxAgeMs = 60 * 60 * 1000, log = null } = {}) {` |

### test/test-actions.mjs（148 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeTmp` | 22-23 | 2 | `function makeTmp(prefix) { return mkdtempSync(join(tmpdir(), `as-act-${prefix}-`)); }` |

### test/test-ast-confirm-span.mjs（61 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `col` | 27-27 | 1 | `const col = (n, needle) => lines[n - 1].indexOf(needle) + 1;` |

### test/test-audit-rule-packs.mjs（219 行 · 5 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 41-41 | 1 | `const hits = (text, rule) => run(text).filter((f) => f.rule === rule);` |
| `has` | 42-42 | 1 | `const has = (text, rule) => hits(text, rule).length > 0;` |
| `msg` | 43-43 | 1 | `const msg = (text, rule) => hits(text, rule)[0]?.message \|\| '';` |
| `makeRepo` | 114-121 | 8 | `function makeRepo(files) {` |
| `auditCsharp` | 124-132 | 9 | `async function auditCsharp(repo) {` |

### test/test-audit-scope.mjs（341 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `read` | 36-36 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |
| `read` | 325-325 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |

### test/test-auditignore.mjs（145 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `setupRepo` | 11-32 | 22 | `function setupRepo() {` |

### test/test-button.mjs（218 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `auditFiles` | 114-122 | 9 | `async function auditFiles(files) {` |

### test/test-collector-ignore.mjs（68 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 21-31 | 11 | `function makeRepo() {` |
| `paths` | 33-33 | 1 | `const paths = (list) => list.map((f) => String(f.path).replace(/\\/g, '/'));` |

### test/test-conv-rule-scope.mjs（46 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `extsOf` | 17-27 | 11 | `function extsOf(id) {` |

### test/test-dataflow.mjs（289 行 · 3 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 30-32 | 3 | `function hits(text) {` |
| `n` | 149-149 | 1 | `const n = (src) => checkClearAccessAst(src).length;` |
| `n` | 238-238 | 1 | `const n = (src) => checkClearAccessAst(src).length;` |

### test/test-docs-score.mjs（187 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 19-27 | 9 | `function makeProject(files) {` |

### test/test-dup.mjs（350 行 · 15 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `parseUser` | 31-36 | 6 | `function parseUser(row) {` |
| `parseOrder` | 37-42 | 6 | `function parseOrder(row) {` |
| `parseItem` | 43-48 | 6 | `function parseItem(row) {` |
| `alpha` | 60-65 | 6 | `function alpha(x) {` |
| `beta` | 68-73 | 6 | `function beta(y) {` |
| `alpha` | 84-88 | 5 | `function alpha() {` |
| `beta` | 91-95 | 5 | `function beta() {` |
| `one` | 106-107 | 2 | `function one(x) { return x + 1; }` |
| `two` | 107-108 | 2 | `function two(x) { return x + 1; }` |
| `three` | 108-109 | 2 | `function three(x) { return x + 1; }` |
| `alpha` | 116-119 | 4 | `function alpha(x) {` |
| `beta` | 120-123 | 4 | `function beta(y) {` |
| `mk` | 133-133 | 1 | `const mk = (fnName) => `` |
| `mk` | 153-153 | 1 | `const mk = (fnName) => `` |
| `mk` | 171-171 | 1 | `const mk = (fnName, params) => `` |

### test/test-empty-catch.mjs（81 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `read` | 65-65 | 1 | `const read = (p) => readFileSync(join(ROOT, p), 'utf8');` |

### test/test-exempt-engines.mjs（182 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeFixtureRepo` | 28-40 | 13 | `function makeFixtureRepo(files = {}) {` |
| `walk` | 164-177 | 14 | `const walk = (dir) => {` |

### test/test-false-positive-fixes.mjs（549 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `ensureDataDir` | 41-45 | 5 | `export async function ensureDataDir(file) { await mkdir(dirname(file), { recursive: true }); }` |
| `saveData` | 42-45 | 4 | `export async function saveData(file, data) {` |
| `tr` | 50-54 | 5 | `export function tr(s, vars) { return s.split('{' + 'k' + '}').join('v'); }` |
| `loadData` | 51-54 | 4 | `export async function loadData() {` |
| `postData` | 55-58 | 4 | `export async function postData() {` |
| `byRule` | 96-96 | 1 | `const byRule = (findings, ruleId) => findings.filter((f) => f.rule === ruleId);` |
| `checkRegexRulesSafe` | 148-159 | 12 | `function checkRegexRulesSafe() {` |
| `hasPatchYml` | 214-214 | 1 | `const hasPatchYml = (gg) => Object.values(gg).flat().some((r) => r.id === 'dsh/patch-insert-unique-id');` |

### test/test-file-health.mjs（124 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `rule` | 10-22 | 13 | `function rule(over = {}) {` |

### test/test-folder-scope.mjs（106 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countSourceDirs` | 28-47 | 20 | `function countSourceDirs(tree, { threshold = 1, excludeDirs = [] } = {}) {` |

### test/test-gitignore-match.mjs（141 行 · 4 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `gitAvailable` | 23-25 | 3 | `function gitAvailable() {` |
| `makeTree` | 29-37 | 9 | `function makeTree() {` |
| `ig` | 41-41 | 1 | `const ig = (text, f) => isIgnored(text, f);` |
| `hits` | 135-135 | 1 | `const hits = (rel) => isIgnoredByRules(rules, rel);` |

### test/test-gitignore-nongit-dir.mjs（40 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `rel` | 17-17 | 1 | `const rel = (list) => list.map((f) => String(f?.path ?? f).replace(SANDBOX + '/', '')).sort();` |

### test/test-history-audit.mjs（111 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 17-29 | 13 | `function makeRepo() {` |

### test/test-lint-adapter.mjs（193 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeProject` | 26-38 | 13 | `function makeProject({ withRuff = false, script = '' } = {}) {` |
| `mk` | 75-75 | 1 | `const mk = (code, msg, file, row) => ruffItemToFinding(` |

### test/test-loop-no-fallback-return.mjs（115 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 19-19 | 1 | `const hits = (src) => [...loopNoFallbackReturnLines(src)].sort((a, b) => a - b);` |

### test/test-magic-number.mjs（130 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `hits` | 16-18 | 3 | `function hits(text) {` |

### test/test-max-lines-scope.mjs（66 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `withScope` | 24-26 | 3 | `function withScope(action) {` |

### test/test-project-type-filter.mjs（91 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `mkRepo` | 17-21 | 5 | `function mkRepo({ name = null } = {}) {` |

### test/test-public-api.mjs（196 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `runCli` | 28-35 | 8 | `function runCli(args) {` |
| `makeBlockerRepo` | 38-49 | 12 | `function makeBlockerRepo() {` |

### test/test-repeated-strings-cs.mjs（53 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `kinds` | 18-18 | 1 | `const kinds = (src) => tokenize(src).filter((t) => t.type === 'str' \|\| t.type === 'tmpl').map((t) => t.type);` |

### test/test-rule-loading.mjs（645 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `block` | 397-400 | 4 | `const block = (text) => {` |

### test/test-scope.mjs（177 行 · 2 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `loadCheckFuncLines` | 132-133 | 2 | `function loadCheckFuncLines() { return { checkFuncLines, checkComplexity }; }` |
| `loadNaming` | 133-134 | 2 | `function loadNaming() { return { checkNameLengthAst }; }` |

### test/test-score-spec.mjs（133 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `walk` | 113-128 | 16 | `const walk = (dir) => {` |

### test/test-score-zero-rule-dims.mjs（80 行 · 1 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `countsExcept` | 22-22 | 1 | `const countsExcept = (...listed) => Object.fromEntries(` |

### test/test-treesitter.mjs（362 行 · 8 个函数）

| 函数 | 行号 | 行数 | 签名 |
|------|------|------|------|
| `makeRepo` | 36-43 | 8 | `function makeRepo(files) {` |
| `auditHits` | 46-69 | 24 | `function auditHits(repo, extraEnv = {}) {` |
| `col` | 92-92 | 1 | `const col = (n, needle) => lines[n - 1].indexOf(needle) + 1;` |
| `countBrokenNodes` | 237-246 | 10 | `function countBrokenNodes(tree) {` |
| `walk` | 239-243 | 5 | `const walk = (node) => {` |
| `textOf` | 248-248 | 1 | `const textOf = (c) => c.lines.join('\n');` |
| `makeRepo` | 313-320 | 8 | `function makeRepo(files) {` |
| `auditRuleHits` | 323-343 | 21 | `function auditRuleHits(repo, rule) {` |

<!-- dshgp-functions:end -->
