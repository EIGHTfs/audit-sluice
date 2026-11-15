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

/** 与 package.json 保持同源（版本只在此处改，清单跟随）。 */
export const AUDIT_PREPROCESS_VERSION = '0.1.0';

/** 清单：端点 + 动作。宿主读它挂路由/注册工具，不要在宿主里硬编码这五条。 */
export const preprocessManifest = {
  id: 'audit',
  label: '审计',
  version: AUDIT_PREPROCESS_VERSION,
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
        { flag: 'json', type: 'boolean', desc: '输出单行 JSON 契约（默认人类可读）' },
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
