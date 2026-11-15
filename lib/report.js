/**
 * 审计报告层：报告用的统计与拦截清单（**审计语义，归本包**）。
 *
 * 为什么在本包：`exemptStats`（这次豁免了哪些类型/几条）、`blocked`（该拦哪些）、
 *   聚合类型清单都是「审计结果的读法」，宿主只需要把它们转给 AI/前端；
 *   放在宿主里会让同一条结论出现两处实现（宿主工具一份、报告/HTTP 一份），
 *   实测代价：宿主侧 `blocked` 曾只筛 `severity==='blocker'`，而 `summarize` 把
 *   `error` 也算拦截级 ⇒「summary 说 10 条、清单只有 7 条」，靠人工比对才发现。
 */

import { isBlockerFinding } from './engine/finding.js';

/** 拦截清单里 message 的截断长度（门禁/工具清单要紧凑，报告明细可用 compact:false）。 */
export const MAX_MSG_PREVIEW = 80;

/** 聚合查询支持的 groupBy 维度（宿主 HTTP 端点与工具提示共用同一份清单）。 */
export const GROUP_BY_KEYS = ['rule', 'file', 'severity', 'slot'];

/** 豁免类型前缀（exemptHint 形态 dsh-skip-<type>（范围）——统计按类型分组）。 */
const EXEMPT_TYPE_RE = /dsh-skip-([a-z-]+)/; // 无 /g：exec 有 lastIndex 状态（多次调用错位）

/**
 * 豁免类型统计（每次审计后输出「本次被豁免的类型与数量」——审计透明性）。
 * 「已确认豁免」（.auditignore 的「路径 : 规则」）与「可选豁免标记」分开统计：
 *   前者是已经生效的豁免（不扣分），后者只是「可以写哪个标记」，混在一起会误判。
 * @param {Array<object>} findings
 * @returns {{types: Record<string, number>, total: number, applied: Record<string, number>, appliedTotal: number}}
 */
export function exemptStatsOf(findings = []) {
  const types = {};
  let total = 0;
  const applied = {};
  let appliedTotal = 0;
  for (const finding of findings) {
    if (finding?.exempted) {
      appliedTotal += 1;
      const key = String(finding.rule || '(未知规则)');
      applied[key] = (applied[key] || 0) + 1;
      continue;
    }
    const hint = String(finding?.exemptHint || '');
    if (!hint) continue;
    total += 1;
    const matched = EXEMPT_TYPE_RE.exec(hint);
    if (matched) {
      const type = matched[1];
      types[type] = (types[type] || 0) + 1;
    } else {
      types.other = (types.other || 0) + 1;
    }
  }
  return { types, total, applied, appliedTotal };
}

/**
 * 该拦的清单（工具/门禁给 AI 看的紧凑形态）。
 *
 * **口径统一**：用 `isBlockerFinding`（blocker + error）——与 `summarize` 的「拦截级」一致。
 *   早先这里只筛 `severity === 'blocker'`，于是 `error` 级（凭据泄露/语法错误）报告算拦截级、
 *   清单里却没有，差额定一个人工比对才能发现。
 * @param {Array<object>} findings
 * @param {{compact?: boolean}} [options] compact=false 时返回完整 message
 * @returns {Array<{file?: string, line?: number, rule?: string, message: string}>}
 */
export function blockedOf(findings = [], { compact = true } = {}) {
  return findings.filter(isBlockerFinding).map((finding) => ({
    file: finding.file,
    line: finding.line,
    rule: finding.rule,
    message: compact ? String(finding.message || '').slice(0, MAX_MSG_PREVIEW) : String(finding.message || ''),
  }));
}
