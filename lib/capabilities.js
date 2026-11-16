/**
 * 审计包对宿主的**稳定能力出口**：只提供已完成的中立能力，不含宿主策略（缓存/job/路由整形）。
 *（历史名 `host-api.js` 已改名 `capabilities.js`——旧名会诱导把宿主逻辑塞进来）
 *
 * 拆包后宿主不再持有审计实现，但它仍需要这几件事**在进程内同步/异步直接拿到**：
 *   · 规则包清单/明细、启停规则（HTTP 端点与侧边栏）
 *   · 审计结果聚合（HTTP `/audit` 的 groupBy）
 *   · 豁免提示（HTTP `exempt-hint`）
 *   · 提交门禁要用的「预处理参数 / 结果文案」（动态参数与拦截文案）
 *   · 少量纯函数（`isBlockerFinding`、收集文本文件、读文本、示例目录判定、豁免标记表）
 *
 * 为什么单独一层而不是都塞进 `lib/index.js`：`lib/index.js` 是对外稳定面（三形态）；
 *   这里是对**宿主**的对接面，可以随宿主需要调整（例如批量聚合、命中统计缓存），
 *   两者混在一起会让「对外契约」被宿主的实现细节污染。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { RULE_YAML_DIR, discoverRuleSlots, loadYamlRuleFile, resolveSlotOrder, setSlotDisabled } from './rule/loader.js';
import { getLastSlotHitStats, setLastSlotHitStats } from './engine/slot-stats.js';
import { EXEMPT_MARKERS, exemptHintForFinding, exemptMarkerCovers, isSampleExemptDir } from './exempt/index.js';
import { isBlockerFinding } from './engine/finding.js';
import { collectTextFiles, readText } from './engine/collector.js';
import { auditPreprocessAvailable, AUDIT_COMMIT_PARAMS, auditPreprocess } from './preprocess/audit.js';
import { preprocessParams, renderPreprocessResult } from './preprocess/index.js';
import { MAX_MSG_PREVIEW } from './report.js';
// 本包配置（禁用的规则包/权重覆盖等）——见 lib/config/load.js
import { loadConfig } from './config/load.js';

export { EXEMPT_MARKERS, MAX_MSG_PREVIEW, RULE_YAML_DIR, auditPreprocessAvailable, AUDIT_COMMIT_PARAMS, collectTextFiles, exemptHintForFinding, exemptMarkerCovers, getLastSlotHitStats, isBlockerFinding, isSampleExemptDir, readText, setLastSlotHitStats };

/**
 * 单个规则包的统计（blocker/warning/pass/total）。
 * 口径与宿主侧边栏一致：`private_files` 条目按「拦截级」计入（它们是私有文件清单规则）。
 */
function ruleSlotStats(loaded) {
  const rules = Array.isArray(loaded?.data?.rules) ? loaded.data.rules : [];
  const listed = Array.isArray(loaded?.data?.private_files) ? loaded.data.private_files.length : 0;
  const total = rules.length + listed;
  const blocker = rules.filter((rule) => rule && (rule.severity === 'blocker' || rule.severity === 'error')).length + listed;
  const warning = rules.filter((rule) => rule && rule.severity === 'warning').length;
  return { blocker, warning, pass: Math.max(0, total - blocker - warning), total, source: 'rules' };
}

/** 规则包按包统计（与宿主侧边栏「规则包」列表同口径）。 */
export function listRuleSlots(order, disabledSlots, hitStats = null) {
  const discovered = discoverRuleSlots(RULE_YAML_DIR);
  // 禁用清单来源：显式传入优先；没传则读**本包自己的配置**（disabledSlots）。
  //   宿主不再替本包保存要禁用哪些规则包——那是「怎么审」的一部分。
  const configDisabled = Array.isArray(disabledSlots) ? null : loadConfig().values.disabledSlots;
  const disabled = Array.isArray(disabledSlots)
    ? disabledSlots
    : (Array.isArray(configDisabled) ? configDisabled : []);
  const slotMeta = {};
  for (const slot of discovered) {
    const loaded = loadYamlRuleFile(slot, RULE_YAML_DIR);
    if (loaded?.ok && loaded.data?.metadata) {
      slotMeta[slot] = {
        name: loaded.data.metadata.name || slot,
        description: loaded.data.metadata.description || '',
        author: loaded.data.metadata.author || '',
        stats: ruleSlotStats(loaded),
        disabled: loaded.data.disabled === true || disabled.includes(slot),
      };
    } else {
      // 加载失败的包也保留条目（f0=0/0/0），避免侧边栏「少了一个包」却没人知道
      slotMeta[slot] = {
        name: slot, description: '', author: '',
        stats: { blocker: 0, warning: 0, pass: 0, total: 0, source: 'rules' },
        disabled: disabled.includes(slot),
      };
    }
  }
  const effectiveOrder = resolveSlotOrder(Array.isArray(order) && order.length ? order : undefined, { dir: RULE_YAML_DIR });
  // 命中统计：宿主侧边栏要显示「本次实际命中」，原样回传（不参与统计计算）
  if (hitStats && typeof hitStats === 'object') {
    for (const [slot, hits] of Object.entries(hitStats)) if (slotMeta[slot]) slotMeta[slot].hits = hits;
  }
  return { discovered, order: effectiveOrder, meta: slotMeta, forced: ['private'] };
}

/** 单个规则包的规则明细。 */
export function ruleDetail(slot) {
  return loadYamlRuleFile(String(slot || ''), RULE_YAML_DIR);
}

/** 启用/禁用规则包（改 yml 顶层 disabled）。 */
export function toggleRule(slot, disabled) {
  return setSlotDisabled(String(slot || ''), disabled === true);
}

/**
 * 审计结果聚合（HTTP `/audit` 的 groupBy 实现）。
 * @param {object} options 见 auditReport（repo/scope + groupBy/severity/top/withFindings）
 * @returns {Promise<object>}
 */
export async function auditAggregate(options = {}) {
  const { auditReport } = await import('./actions.js');
  const report = await auditReport({ ...options, includeFindings: false, summaryOnly: true });
  if (report?.ok === false) return report;
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const groupBy = ['rule', 'file', 'severity', 'slot'].includes(options.groupBy) ? options.groupBy : 'rule';
  const severityFilter = String(options.severity || '').split(',').map((item) => item.trim()).filter(Boolean);
  const filtered = severityFilter.length ? findings.filter((finding) => severityFilter.includes(finding.severity)) : findings;
  const groups = new Map();
  for (const finding of filtered) {
    const key = String(finding[groupBy] || '(未分类)');
    if (!groups.has(key)) groups.set(key, { key, count: 0, blocker: 0, warning: 0, notice: 0, findings: [] });
    const bucket = groups.get(key);
    bucket.count += 1;
    bucket[finding.severity] = (bucket[finding.severity] || 0) + 1;
    bucket.findings.push(finding);
  }
  const top = Number.isFinite(Number(options.top)) && Number(options.top) > 0 ? Number(options.top) : 20;
  return {
    ok: true,
    repo: report.repo || options.repo,
    scope: report.scope,
    summary: report.summary,
    quality: report.quality,
    groupBy,
    groups: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, top),
  };
}

/** 预处理参数（宿主「参数动态注册」用：审计不可用时这几条参数不出现）。 */
export function auditParams(cfg = {}, hasBuiltinEngine) {
  return preprocessParams(cfg, hasBuiltinEngine);
}

/** 审计结果文案渲染（宿主提交门禁的 apiGuide / 拦截文案 / 豁免 note）。 */
export function renderAuditResult(ctx = {}, cfg = {}) {
  return renderPreprocessResult(ctx, cfg, [auditPreprocess]);
}

/** 供宿主做「标记表快照」一致性测试用。 */
export function exemptMarkerKeys() {
  return Object.keys(EXEMPT_MARKERS).sort();
}

/** 供宿主复用的「文件是否可读文本」判定（历史/收集类工具用）。 */
export function isReadableTextFile(path = '') {
  try { return statSync(path).isFile() && existsSync(path); } catch { return false; }
}

/** 供宿主回显报告目录（历史审计）。 */
export function defaultReportDir(repo = '') {
  return join(String(repo || '.'), '.audit-history');
}

/** 供宿主快速判断某文件是否为文本（沿用 collector 口径的最小封装）。 */
export function readTextIfPossible(path = '') {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}
