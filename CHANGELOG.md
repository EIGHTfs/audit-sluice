# 更新日志

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
