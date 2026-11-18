# 更新日志

## 0.1.4

- 修：审计扩展脚本（`scripts/audit-ext/*.mjs`）**无视 `.auditignore` / `.gitignore` / `scope`**——
  两个 ext 各自 `readdirSync` 全仓递归、只跳 `SKIP_DIRS` ⇒ 被 gitignore 忽略的上游源码快照目录
  照样被扫出 blocker，把一次纯文档改动拦住。现在引擎把「本次扫描的文件集 + scope」传给 ext，
  ext 优先用它（无 files 时才退回全仓）
- 修：`variable-min-length.mjs` 两处 import 指向拆包前的旧目录（`lib/audit/*` → `lib/engine/*`）。
  这两行抛错后被 `catch {}` 吞掉 ⇒ gitignore 判定恒为空（完全不忽略）、构建产物豁免恒失效，全是静默失效
- 修：`paths/hardcoded-absolute-path` 把 **shell/批处理变量拼接**当字面路径
  （`/var/packages/${PACKAGE_NAME}`、`/var/log/packages/$(echo …)`、`$HOME/x`、`%APPDATA%\x`）——
  实测一个 NAS 打包仓库有 33 处被误报 blocker。变量拼接不是字面路径，不报
- 修：系统标准目录（`/usr`、`/etc`、`/var`、`/opt/homebrew`、`/dev/shm`）归 `paths/system-path-literal`
  （**warning**，建议改用常量/探测），不再当「换机失效」的 blocker。实测 `/usr/syno/bin/synopkg`、
  `/etc/passwd`、`/var/cache/synopkg/*` 全被误报
- 修：`describeHardcodedAbsPath` 的不可访问分支不再写「⇒ 仅警告」——severity 由规则决定，文案不该替它下结论
- 文档：22 个文件 25 处注释里的旧目录名 `lib/audit/` → `lib/engine/`
- 测试：新增 `test/test-ext-respects-file-list.mjs`（3 条：传 files 只扫列出文件 / 不传退回全仓 /
  传空数组等同不传）；596 / 596 通过

## 0.1.3

- 新增槽位 `shell`：`shell/continuation-comment`（blocker）——续行符 `\` 后紧跟注释，
  导致变量赋值/参数列表静默错位（不报错、退出码正常、结果不对）。跨行判定，排除 heredoc 内与转义反斜杠
- 新增槽位 `dotenv`：`dotenv/unquoted-hash`（warning）——`.env` 里 `KEY=abc#def` 的 `#` 被当行内注释，
  实际值只有 `abc`（静默截断）。含 `#` 的值必须加引号
- 新增规则 `paths/system-path-literal`（warning）：`/tmp`、`/usr/bin` 等系统标准路径**字面量**建议改用
  跨平台常量（`os.tmpdir()` / `process.execPath` / which 探测）。与 `paths/hardcoded-absolute-path` 按
  systemKind 分流，同一行只归一条
- 修：规则注释早写着「已排除临时目录与系统工具目录」，但 `isReasonableAbsolutePath` 从未实现
  ⇒ `/tmp` 一直被当 blocker 误报。本次把逻辑真正落地
- 修：`.env` 系列文件**从来没进过审计管道**（`extname('.env') === ''`、`extname('.env.local') === '.local'`
  ⇒ 扩展名白名单判定失败）⇒ dotenv 规则写好也永远 0 命中。按 `isTextFile` 已有口径补 dotfile 特判
- 文档：槽位表更新为实测快照（25 槽位 / 172 规则）+ 附刷新脚本（手改数字必然与代码漂移）

## 0.1.2

- `manifest` 的 `cliFlagMap` key 改为「`stage.args` 的键名」（`exemptPaths` / `reason`），宿主不再需要知道这些键对应哪个 CLI flag
- 删 `commitParams`：不再向宿主贡献工具顶层参数；参数改由调用方通过 `preprocessStages[].args` 传入
- 删 `legacyEnv`（`DSH_AUDIT_SLUICE_CLI`）：不再兼容旧环境变量名，只认 `DSH_PREPROCESS_<ID>_CLI`

## 0.1.1

- 清出包内宿主私货：凭据读取（`core/credentials.js`）、GitHub 镜像（`core/endpoints.js` / `mirror-store.js`）、宿主配置 schema（`config/{defaults,schema}.js`）、UI 分片与 ui-sdk、`engine/public.js`、`cli/{commands-doc,module-splitter}.js`、`shared/tools/`
- 自带独立配置 `lib/config/load.js` + `config` 子命令：`$AUDIT_SLUICE_HOME` → `$DSH_HOME/audit-sluice` → `~/.audit-sluice`；优先级 **命令行 > 配置文件 > 内置默认**；宿主遗留键作兜底并标出来源，`config --migrate` 才落盘
- `core/exec.js` 收窄：只保留本地 git 动作（`log` / `archive` 等），去掉镜像注入、传输看门狗与宿主门禁开关
- 修 `isInsideGitWorkTree` 的裸 git 调用（缺 `safe.directory=*` 时，属主与运行用户不同的仓库被误判「不是 git 仓库」）
- 不再写死可执行文件位置：git 改为 `DSH_GIT_BIN` → `PATH` 自探测，lint 工具不再拼 `/usr/bin` 前缀
- CLI 支持 `--version` / `--help`，并修符号链接安装（`node_modules/.bin`）下静默无输出的故障
- `manifest` 的版本改为读 `package.json`（此前写死常量，发版后与包版本漂移）
- 删 15 个无法 import 的 `from-host` 测试（原基线 15 个 fail 全部来自它们，实际从未运行过）
- 打包收紧 `files`：排除测试、`docs/`、开发脚本；保留运行时必需的 `scripts/scan-file-io.mjs` / `doc-tree.mjs` / `doc-func.mjs` / `audit-ext/`
- 新增 GitHub Actions：`npm ci` + 语法/JSON 门禁 + `node --test test/*.mjs`

## 0.1.0

- 首次发布：审计引擎（AST/正则规则、评分、豁免）+ 独立 CLI（`audit` / `manifest` / `io_scan` / `link_check` / `scope_check` / `exempt_hint`）
- 输出单行 JSON 契约（stdout），退出码 `0` 无拦截 / `1` 有拦截 / `2` 执行失败
- 规则以 YAML 声明（23 个规则包），可按 `--ruleset` 指定自定义规则目录、`--weights` 覆盖维度权重
- 内部中间层：引擎适配器 / 豁免编排 / 评分编排 / 结果文案渲染
