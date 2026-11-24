/**
 * 拦截判定（**本包的权威结论**）——把所有豁免叠加后，算出「到底该不该拦」。
 *
 * 为什么这一段必须在本包（而不是调用方）：
 *   豁免有四类，来源各异，但结论只有一个：**这批 findings 里还有没有真该拦的**。
 *   若把判定留在调用方（宿主插件），独立包就变成「只报数字、不负责结论」的半个工具，
 *   调用方各自实现一遍 ⇒ 「该拦的不拦 / 该放的不放」只在某一侧出现，最难查。
 *
 * 四类豁免的归属（本包内闭环）：
 *   ① 代码标记（`dsh-skip-*` / `.auditignore`）→ 引擎逐文件判（lib/engine/audit-file.js）
 *   ② 目录类别（测试夹具 `.test`）→ 收集器判（lib/engine/collector.js）
 *   ③ 示例目录（`.samples`）→ **本文件**判（示例里的 blocker 是规则演示，不拦真实提交）
 *   ④ 临时豁免（`exemptPaths`，仅本次、不落盘）→ **本文件**判
 *   另有 ⑤ 私有库：`visibility === 'private'` ⇒ 只报告不拦截（本文件兜住，结论是「不拦」）。
 *
 * ⚠️ `summary.blocker` 与 `blocked` **刻意不同**：
 *   `summary.blocker` 是引擎原始计数（问题规模，用于报告与趋势）；
 *   `blocked` 是叠加豁免后的拦截结论（用于门禁）。
 *   把两者合并会同时毁掉「问题规模可观测」与「豁免语义可解释」。
 */

import { isSampleExemptDir } from './exempt/index.js';
import { isBlockerFinding } from './engine/finding.js';

/** 拦截清单里 message 的截断长度（与宿主门禁口径一致：清单只用于指路，明细走聚合 API）。 */
export const MAX_MSG_PREVIEW = 80;

/** 豁免路径归一化：统一斜杠、去 `./` 前缀、去空白（与引擎侧路径口径一致）。 */
export function normalizeExemptPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** 归一化后的路径集合（空集合 = 没有临时豁免）。 */
export function normalizeExemptPaths(exemptPaths) {
  return new Set((Array.isArray(exemptPaths) ? exemptPaths : [])
    .map(normalizeExemptPath)
    .filter(Boolean));
}

/**
 * 计算拦截结论。
 *
 * @param {Array<object>} findings 引擎产出的 findings（已过代码标记/目录类别豁免）
 * @param {object} opts
 * @param {string} [opts.repoPath] 仓库根（示例目录判定需要它）
 * @param {string[]} [opts.exemptPaths] 本次临时豁免的相对路径
 * @param {string} [opts.exemptReason] 豁免理由（仅回显）
 * @param {boolean} [opts.compact=true] 拦截清单里的 message 是否截断到 MAX_MSG_PREVIEW
 *   —— 门禁清单要紧凑（够指路即可），报告明细要完整；两种用途本来就该不同口径，
 *      所以做成显式开关而不是改默认（默认改了就同时改变门禁口径）。
 * @param {string} [opts.visibility] `private` | `public` | `unknown`
 *   —— **`unknown` 与 `public` 同口径（保守拦截）**：判不清可见性时宁可拦，
 *      放松红线只允许发生在「明确 private」时。
 * @returns {{
 *   blocked: Array<{file?: string, line?: number, rule?: string, message: string}>,
 *   blockedCount: number,
 *   exempt?: {files: string[], count: number, rules: string[], reason?: string},
 *   privateExempt?: {visibility: string, blockedCount: number},
 *   sampleExemptCount: number,
 *   ok: boolean
 * }}
 */
export function computeBlocked(findings = [], opts = {}) {
  const repoPath = opts.repoPath || '.';
  const exemptSet = normalizeExemptPaths(opts.exemptPaths);
  const isExemptFile = (finding) => exemptSet.size > 0 && exemptSet.has(normalizeExemptPath(finding.file));
  const exemptFindings = exemptSet.size ? findings.filter(isExemptFile) : [];

  // 示例目录（`.samples`）与临时豁免在这层滤掉；代码标记/测试夹具豁免已在引擎侧生效。
  const sampleExempt = [];
  const blockingFindings = findings.filter((finding) => {
    // 与 summarize / 三处枚举同口径（isBlockerFinding = blocker|error）。
    //   2026-10-17 引入该函数时统一了报告侧，但提交门禁这一处漏改，
    //   结果「凭据泄露类（error）在报告里算拦截级、门禁却永不拦」——
    //   报告说有 N 条拦截级、实际只拦了 blocker，差额永远对不上。
    if (!isBlockerFinding(finding)) return false;
    // 细粒度豁免（.auditignore 的「路径 : 规则」）由编排层 applyScopedExemptions 标记为
    //   finding.exempted：它不进评分、不进 summary，但门禁这层此前漏了这个判断 ⇒
    //   出现「报告显示 0 拦截、提交门禁却照样拦」的自相矛盾（实测于 Kotlin 类体被
    //   max-function-length 误判为函数的场景）。豁免语义是「已确认不拦」，故此处必须排除。
    if (finding.exempted) return false;
    if (isExemptFile(finding)) return false;
    if (isSampleExemptDir(repoPath, finding.file)) { sampleExempt.push(finding); return false; }
    return true;
  });

  const compact = opts.compact !== false;
  const blocked = blockingFindings.map((finding) => ({
    file: finding.file,
    line: finding.line,
    rule: finding.rule,
    message: compact ? String(finding.message || '').slice(0, MAX_MSG_PREVIEW) : String(finding.message || ''),
  }));

  const exempt = exemptSet.size
    ? {
      files: [...exemptSet],
      count: exemptFindings.length,
      rules: [...new Set(exemptFindings.map((finding) => finding.rule).filter(Boolean))],
      ...(opts.exemptReason ? { reason: String(opts.exemptReason) } : {}),
    }
    : undefined;

  // 私有库：只报告不拦截。注意 `blocked` 置空、但 `blockedCount` 保留原始条数——
  //   调用方要能回答「私有库本来有几条会拦」（这是「降级而非忽略」的可观测性）。
  if (String(opts.visibility || 'unknown') === 'private') {
    return {
      blocked: [],
      blockedCount: 0,
      exempt,
      privateExempt: { visibility: 'private', blockedCount: blocked.length },
      sampleExemptCount: sampleExempt.length,
      ok: true,
    };
  }

  return {
    blocked,
    blockedCount: blocked.length,
    exempt,
    privateExempt: undefined,
    sampleExemptCount: sampleExempt.length,
    ok: blocked.length === 0,
  };
}
