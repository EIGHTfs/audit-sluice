import { readFileSync } from 'node:fs';

/**
 * 预处理清单（`audit-sluice manifest --json`）
 *
 * 为什么需要它：本包是**被宿主挂载**的（宿主负责 HTTP 路由 / MCP 工具注册 / UI 面板）。
 *   宿主不该「知道审计有哪些端点、每个端点什么方法」——那是本包的实现细节，
 *   一改就得同步改宿主。改为本包**自报清单**，宿主读清单挂路由即可。
 *
 * 形状约定（设计稿 §9.2）：
 *   { id, label, version, endpoints:[{path, method, desc}], actions:[{action, params, desc}] }
 *   - `path` 是**相对路径片段**（宿主决定前缀，如 `/api/git-audit`）；
 *   - `params` 与 CLI 参数一一对应（同一个能力两种入口，字段不改名）。
 */

/**
 * 版本**从 package.json 读**，不在代码里写第二份。
 *
 * 为什么：清单要报"我是哪个版本"，写死的常量必然与发版漂移（实测 0.1.1 的包里
 *   清单还报 0.1.0）。读 package.json 是唯一真相，换版本只改一处。
 */
export const AUDIT_PREPROCESS_VERSION = (() => {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    return String(JSON.parse(readFileSync(pkgUrl, 'utf8')).version || '0.0.0');
  } catch { return '0.0.0'; }
})();

/** 清单：端点 + 动作。宿主读它挂路由/注册工具，不要在宿主里硬编码这五条。 */
export const preprocessManifest = {
  id: 'audit',
  label: '审计',
  version: AUDIT_PREPROCESS_VERSION,
  // ── 阶段参数 → CLI flag 的映射（`preprocessStages[].args` 的键名 → 本实现的命令行参数）──
  //   宿主完全不认识这些键：它只把 args 原样收下，按本表翻成 CLI flag。
  //   kind：csv = 数组拼逗号；string = 原样传。
  cliFlagMap: {
    exemptPaths: { flag: '--exempt-paths', kind: 'csv' },
    reason: { flag: '--exempt-reason', kind: 'string' },
  },

  endpoints: [
    { path: 'audit', method: 'GET', desc: '审计结果聚合（按 rule/file/severity/slot 分组）' },
    { path: 'rule-slots', method: 'GET', desc: '规则包槽位与条数统计' },
    { path: 'rule-detail', method: 'GET', desc: '单个规则包的规则明细' },
    { path: 'toggle-rule', method: 'POST', desc: '启用/禁用规则包' },
    { path: 'exempt-hint', method: 'GET', desc: '该写哪个豁免标记（按 finding 推导）' },
  ],
  actions: [
    {
      action: 'audit',
      desc: '审计仓库（返回 summary / quality / findings / blocked）',
      params: [
        { flag: 'repo', type: 'string', required: true, desc: '仓库绝对路径' },
        { flag: 'scope', type: 'string', enum: ['diff', 'full'], desc: '审计范围（默认 diff）' },
        { flag: 'visibility', type: 'string', enum: ['private', 'public', 'unknown'], desc: '仓库可见性：private 只报告不拦截；unknown 与 public 同口径（保守拦截）' },
        { flag: 'exemptPaths', type: 'array', desc: '本次临时豁免的相对路径（仅本次、不落盘）' },
        { flag: 'exemptReason', type: 'string', desc: '豁免理由（仅回显）' },
        { flag: 'rulesetDir', type: 'string', desc: '自定义规则包目录（缺省用内置 rules/）' },
        { flag: 'weights', type: 'string', desc: '维度权重覆盖（JSON 对象字符串）' },
        { flag: 'compact', type: 'boolean', desc: '拦截清单 message 截断（默认 true，80 字符，供门禁指路）；报告形态传 false 取完整 message' },
        { flag: 'json', type: 'boolean', desc: '输出单行 JSON 契约（默认人类可读）' },
      ],
    },
    {
      action: 'io_scan',
      desc: 'IO 风险扫描（AST 四级分级：high/medium/low/safe，与审计 robustness/io-risk 同标准）',
      params: [
        { flag: 'repo', type: 'string', desc: '待扫描目录（缺省用会话工作区）' },
        { flag: 'writeOnly', type: 'boolean', desc: '只看写操作' },
        { flag: 'json', type: 'boolean', desc: '输出单行 JSON' },
      ],
    },
    {
      action: 'link_check',
      desc: '文档链接检查（本地/相对链接是否存在、锚点是否有效）',
      params: [
        { flag: 'path', type: 'string', desc: '待检查的文件或目录（缺省用会话工作区）' },
        { flag: 'json', type: 'boolean', desc: '输出单行 JSON' },
      ],
    },
    {
      action: 'scope_check',
      desc: '拼接产物作用域撞名检查（缺省读 package.json 的 dshScopeCheck.files）',
      params: [
        { flag: 'repo', type: 'string', desc: '仓库绝对路径（缺省当前目录）' },
        { flag: 'files', type: 'array', desc: '待检查文件（逗号分隔；缺省按项目声明）' },
        { flag: 'prefix', type: 'string', desc: '强制该前缀（覆盖推导）' },
        { flag: 'allowlist', type: 'array', desc: '前缀例外名单（逗号分隔）' },
        { flag: 'topLevelMustBeEmpty', type: 'boolean', desc: '要求顶层零声明' },
        { flag: 'json', type: 'boolean', desc: '输出单行 JSON' },
      ],
    },
    {
      action: 'exempt_hint',
      desc: '注释豁免标注：add/remove/list/check（标记映射与审计判定同源）',
      params: [
        { flag: 'action', type: 'string', required: true, enum: ['add', 'remove', 'list', 'check'], desc: '动作' },
        { flag: 'repo', type: 'string', desc: '仓库根（缺省当前目录）' },
        { flag: 'path', type: 'string', desc: '目标文件（相对仓库根）' },
        { flag: 'line', type: 'number', desc: '1-based 行号（scope=line 时必填）' },
        { flag: 'scope', type: 'string', desc: 'header | line' },
        { flag: 'rule', type: 'string', desc: '规则名（用于推导标记）' },
        { flag: 'marker', type: 'string', desc: '显式指定 dsh-skip-*（与 rule 冲突会拒绝）' },
        { flag: 'reason', type: 'string', desc: '写进注释的理由' },
        { flag: 'dryRun', type: 'boolean', desc: '只预览不写盘' },
        { flag: 'json', type: 'boolean', desc: '输出单行 JSON' },
      ],
    },
    {
      action: 'manifest',
      desc: '输出本清单（宿主据此挂路由/注册工具）',
      params: [{ flag: 'json', type: 'boolean', desc: '输出单行 JSON' }],
    },
  ],
};

/**
 * 取清单的深拷贝（调用方改自己的副本不影响共享常量）。
 * @returns {object}
 */
export function getPreprocessManifest() {
  return JSON.parse(JSON.stringify(preprocessManifest));
}
