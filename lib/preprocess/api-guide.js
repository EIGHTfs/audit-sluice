/**
 * 审计结果文案：聚合 API 查询指引 + 本次审计的关键回显。
 *
 * 为什么在本包：这段文案讲的是「审计结果怎么查、这次豁免了什么、拦了谁」——全是审计语义。
 *   宿主只负责把它塞进回复里（工具返回值 / HTTP 响应），不该自己拼这些字。
 * 措辞与拆包前逐字一致（宿主工具面靠它保持返回字段稳定）。
 */
import { networkInterfaces } from 'node:os';

const DEFAULT_PORT = 30800;
// HTTP 前缀仍是宿主当前挂载的 /api/git-audit（指引里的 URL 要能直接 curl 通）；
//   批 D2 把端点搬到 /api/preprocess/audit/* 时，这里与宿主路由**同一提交**改。
const AUDIT_PATH = '/api/git-audit/audit';

let cachedHostIp = '';

/** 本机局域网 IPv4（取第一个非回环地址）：指引要给同网段可直接访问的地址。 */
function detectHostIp() {
  if (cachedHostIp) return cachedHostIp;
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) { cachedHostIp = ni.address; break; }
      }
      if (cachedHostIp) break;
    }
  } catch { /* 取不到就用回环 */ }
  return cachedHostIp || '127.0.0.1';
}

/**
 * 生成审计结果查询指引。
 * @param {string} [repo] 被审计仓库绝对路径（URL 编码进 query）
 * @param {{summary?: object, quality?: object, scope?: string, groupBy?: string,
 *          exemptStats?: object, groupByTypes?: string[], blocked?: object[]}} [opts]
 * @returns {string}
 */
export function buildAuditApiGuide(repo = '', opts = {}) {
  const summary = opts.summary || {};
  const quality = opts.quality || {};
  const scope = (opts.scope || 'full') === 'full' ? 'full' : 'diff';
  const queryString = `repo=${encodeURIComponent(repo || '')}&scope=${scope}&groupBy=${opts.groupBy || 'rule'}`;
  const base = `http://${detectHostIp()}:${DEFAULT_PORT}${AUDIT_PATH}`;
  const lines = [];
  lines.push(`审计：${repo || ''}（${scope === 'full' ? '全量' : '变动'}）`);
  lines.push(`评分 ${quality.score ?? '?'}/${quality.level ?? '?'} · ${summary.blocker ?? 0} 拦截 / ${summary.warning ?? 0} 警告 / ${summary.notice ?? 0} 提示`);
  lines.push('审计明细请用聚合 API 查询（参数已自动填充，直接复制使用）：');
  lines.push(`  ${base}?${queryString}`);
  // -L：宿主反代一次 302 中转（不带 -L 会显示 302 误判失败）
  lines.push(`  curl -L '${base}?${queryString}'`);
  lines.push(`可选参数（默认已填，按需改 URL 即可）：groupBy=${opts.groupBy ? '自定义' : 'rule'}（默认）<可选 rule|file|severity|slot> · severity 过滤（如 &severity=blocker,warning）`);
  const exemptStats = opts.exemptStats;
  // 已确认豁免（.auditignore 细粒度规则）：单列一节，与「未处理问题」明确分开
  //   —— 这些 finding 不扣分、不计入警告数，但必须可见（否则等于静默消失）。
  if (exemptStats && exemptStats.appliedTotal > 0) {
    const detail = Object.entries(exemptStats.applied || {}).map(([rule, count]) => `${rule} ${count}`).join(' / ');
    lines.push(`已确认豁免 ${exemptStats.appliedTotal} 条（.auditignore 细粒度，不扣分）：${detail}`);
  }
  if (exemptStats && exemptStats.total > 0) {
    const parts = Object.entries(exemptStats.types || {}).map(([type, count]) => `${type} ${count}`).join(' / ');
    lines.push(`豁免：${exemptStats.total} 条（${parts}）`);
  }
  const groupByTypes = Array.isArray(opts.groupByTypes) ? opts.groupByTypes.join('|') : '';
  if (groupByTypes) lines.push(`聚合类型：${groupByTypes}`);
  const blockedList = Array.isArray(opts.blocked) ? opts.blocked : [];
  if (blockedList.length) {
    lines.push(`拦截：${blockedList.length} 个 blocker → ${blockedList.map((item) => `${item.file || ''}${item.line ? ':' + item.line : ''}（${item.rule || item.message}）`).join('；')}`);
  }
  return lines.join('\n');
}
