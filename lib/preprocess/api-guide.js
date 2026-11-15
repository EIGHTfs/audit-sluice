/**
 * 审计结果文案：聚合 API 查询指引（**审计侧自己的措辞**）。
 *
 * 为什么在本包里另有一份：这段文案讲的是「审计结果怎么查」（URL + 参数填充），属审计语义；
 *   在 gitpush 里它与插件其它注入文案同处 inject-text.js，但那文件还依赖 git 侧（仓库/身份），
 *   搬进审计包会把整条 git 依赖链拖进来 —— 独立包不该为了几句文案背上 git 实现。
 *   两侧文案由各自测试守住一致性（本包 test/audit-guide 断言关键措辞）。
 */
import { networkInterfaces } from 'node:os';

const DEFAULT_PORT = 30800;
const AUDIT_PATH = '/api/git-audit/audit';

let cachedHostIp = '';
/** 本机局域网 IPv4（取第一个非回环地址）：apiGuide 要给同网段可直接访问的地址。 */
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
 * 生成「审计明细查询」指引文本。
 * @param {string} [repo] 被审计仓库绝对路径（会 URL 编码进 query）
 * @param {{summary?: object, quality?: object, scope?: string, groupBy?: string}} [opts]
 * @returns {string}
 */
export function buildAuditApiGuide(repo = '', opts = {}) {
  const summary = opts.summary || {};
  const quality = opts.quality || {};
  const scope = (opts.scope || 'full') === 'full' ? 'full' : 'diff';
  const qs = `repo=${encodeURIComponent(repo || '')}&scope=${scope}&groupBy=${opts.groupBy || 'rule'}`;
  const base = `http://${detectHostIp()}:${DEFAULT_PORT}${AUDIT_PATH}`;
  return [
    `审计：${repo || ''}（${scope === 'full' ? '全量' : '变动'}）`,
    `评分 ${quality.score ?? '?'}/${quality.level ?? '?'} · ${summary.blocker ?? 0} 拦截 / ${summary.warning ?? 0} 警告 / ${summary.notice ?? 0} 提示`,
    '审计明细请用聚合 API 查询（参数已自动填充，直接复制使用）：',
    `  ${base}?${qs}`,
    `  curl -L '${base}?${qs}'`,
  ].join('\n');
}
