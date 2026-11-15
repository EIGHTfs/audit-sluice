/**
 * 审计包的「动作」实现（library / CLI / manifest 三形态共用同一份）。
 *
 * 与 `audit()` 的区别：`audit()` 是**提交门禁**那条重路径（跑全仓/改动集、评分、拦截结论）；
 * 这里的四个 action 是**按需查询类**能力——单文件扫描、链接检查、拼接产物撞名、豁免标注。
 * 它们原先散在宿主插件的工具层（`lib/app/tool-call.js`），拆包后归属本包：
 *   判定逻辑本来就是审计语义，住在宿主里会让「审计能力清单」分裂成两处。
 *
 * 三条约束（宿主工具靠它们保持返回字段稳定）：
 *   ① 返回对象字段**逐个保持原样**（宿主侧工具直接把它转给 AI，少一个字段就少一条判断依据）；
 *   ② 不改入参语义（`files`/`allowlist` 之类的逗号分隔串在这里归一化，宿主不必各自解析）；
 *   ③ 失败一律 `{ ok: false, error }`，不抛异常（工具层要把错误当返回值给 AI 看）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { existsSync } from 'node:fs';

import { checkLinks, sumLinkPenalty } from './link-check/index.js';
import { formatAnalysisCoverageLine } from './engine/analysis-coverage.js';
import { isBlockerFinding, summarize } from './engine/finding.js';
import { buildAuditApiGuide } from './preprocess/api-guide.js';
import { runPreprocess } from './preprocess/index.js';
import { score } from './preprocess/score.js';
import { blockedOf, exemptStatsOf, GROUP_BY_KEYS } from './report.js';
import { runScopeCheck } from './scope-check.js';
import { readProjectScopePolicy } from './engine/scope-policy.js';

/** 读文件（失败返回空串）：链接检查对不可读文件按「无链接」处理，不当作错误。 */
function readTextSafe(path = '') {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

/** 逗号/分号/空白分隔的清单串 → 数组（宿主工具历来接受三种分隔符）。 */
function splitList(value) {
  return String(value || '').split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean);
}

/**
 * 审计报告（`code_audit` 工具那条路径）：跑审计 + 评分 + 豁免统计 + 拦截清单 + 查询指引。
 *
 * 与 `audit()` 的差别：`audit()` 是**门禁**形态（给 blocked 结论、供提交前拦截）；
 *   本函数是**报告**形态（给 AI/前端读：评分、豁免统计、按需 findings/yaml）。
 *   两者共用同一次引擎运行逻辑（`runPreprocess`），只是整形不同——
 *   刻意不合并成一个「什么都有」的巨型返回，避免门禁路径被报告字段拖慢。
 *
 * 返回字段与拆包前的宿主工具**逐个相同**（宿主直接把本函数结果转给 AI）。
 * @param {object} options
 * @param {string} options.repo 仓库绝对路径（必填）
 * @param {'diff'|'full'} [options.scope]
 * @param {object} [options.weights] 维度权重覆盖
 * @param {string} [options.rulesetDir] 自定义规则目录
 * @param {number} [options.maxScanFiles]
 * @param {string[]} [options.slots]
 * @param {string[]} [options.disabledSlots]
 * @param {boolean} [options.includeFindings] 是否返回 findings（默认 true；大仓可关）
 * @param {boolean} [options.summaryOnly] 只要结论
 * @param {boolean} [options.coverage] 是否计算分析覆盖率（默认 true；false 时不返回 analysisCoverage、
 *   文本摘要里也不带覆盖率行）——它是**信息项**，不影响 summary/quality
 * @returns {Promise<object>}
 */
export async function auditReport({
  repo = '', scope = 'diff', weights = {}, rulesetDir = '', maxScanFiles, slots, disabledSlots,
  includeFindings = true, summaryOnly = false, coverage,
} = {}) {
  if (!repo) return { ok: false, error: 'repo 必填' };
  let isGitDir = true;
  try { isGitDir = existsSync(join(repo, '.git')); } catch { isGitDir = false; }
  const fullScope = scope === 'full' || !isGitDir;
  const pre = await runPreprocess(resolve(repo), {
    scope: fullScope ? 'full' : 'diff',
    rulesetDir,
    weights,
    ...(Number.isFinite(Number(maxScanFiles)) ? { maxScanFiles: Number(maxScanFiles) } : {}),
    ...(Array.isArray(slots) && slots.length ? { slots } : {}),
    ...(Array.isArray(disabledSlots) ? { disabledSlots } : {}),
    // 覆盖率是信息项：引擎侧按此开关计算，默认开（显式 false 才关）
    ...(coverage === false ? { coverage: false } : {}),
  });
  const engineAudit = pre.audit || {};
  const findings = pre.findings;
  const summary = summarize(findings);
  const quality = score(findings, pre.scoreSpec, weights, {
    files: pre.files,
    dimFileCounts: engineAudit.dimFileCounts,
    dimRuleCounts: engineAudit.dimRuleCounts,
  });
  const exemptStats = exemptStatsOf(findings);
  const blocked = blockedOf(findings);
  const apiGuide = buildAuditApiGuide(repo, {
    scope: engineAudit.scope, summary, quality, exemptStats, blocked, groupByTypes: GROUP_BY_KEYS,
  });
  const analysisCoverage = engineAudit.analysisCoverage || null;
  const withFindings = includeFindings !== false && summaryOnly !== true;
  const out = {
    ok: true,
    scope: engineAudit.scope,
    files: engineAudit.files,
    summary,
    quality,
    exemptStats,
    blocked,
    groupByTypes: GROUP_BY_KEYS,
    apiGuide,
    slotStats: engineAudit.slotStats,
  };
  if (analysisCoverage) {
    out.analysisCoverage = analysisCoverage;
    out.apiGuide = `${apiGuide}\n${formatAnalysisCoverageLine(analysisCoverage)}`;
  }
  if (withFindings) {
    out.findings = findings;
    if (engineAudit.yaml) out.yaml = engineAudit.yaml;
  }
  return out;
}

/**
 * 历史审计（按 commit 区间逐版本审计 + 生成报告）。
 *
 * 宿主只负责「起不起后台 job / 报告目录放哪」这类运行时决策；实际的历史遍历与评分在本包内。
 * @param {{repo: string, since?: string, until?: string, outDir?: string, auditOpts?: object, weights?: object}} options
 * @returns {Promise<object>}
 */
export async function auditHistory({ repo = '', since = '', until = '', outDir = '', auditOpts = {}, weights = {} } = {}) {
  if (!repo) return { ok: false, error: 'repo 必填' };
  const { runHistoryAudit } = await import('./engine/history.js');
  const { resolveReportDir } = await import('./engine/history-report.js');
  const reportDir = resolveReportDir(resolve(repo), outDir || '');
  const result = await runHistoryAudit(resolve(repo), { since, until, outDir: reportDir, auditOpts, weights });
  return { ...result, reportDir };
}

/**
 * IO 风险扫描（AST 四级分级，与审计 `robustness/io-risk` 同标准）。
 *
 * 为什么直接复用 `scripts/scan-file-io.mjs` 而不在本文件重写：判定口径必须与审计规则同源，
 *   两套实现必然漂移（宿主侧曾各自实现过，结果同一文件两边给出不同等级）。
 * @param {{root?: string, writeOnly?: boolean}} [options]
 * @returns {{ok: boolean, root?: string, total?: number, sync?: number, byRisk?: object, items?: object[], error?: string}}
 */
export async function ioScan({ root = '', writeOnly = false } = {}) {
  if (!root) return { ok: false, error: 'repo 必填（或用会话工作区）' };
  const { scanFileIo } = await import('../scripts/scan-file-io.mjs');
  const hits = scanFileIo({ targets: [root], writeOnly: writeOnly === true });
  const byRisk = { high: 0, medium: 0, low: 0, safe: 0 };
  for (const hit of hits) if (byRisk[hit.risk] != null) byRisk[hit.risk] += 1;
  const sync = hits.filter((hit) => hit.type === 'sync').length;
  return { ok: true, root, total: hits.length, sync, byRisk, items: hits };
}

/**
 * 链接检查（本地/相对链接是否存在、锚点是否有效）。
 * @param {{path?: string}} [options]
 * @returns {Promise<{ok: boolean, count?: number, penalty?: number, findings?: object[], error?: string}>}
 */
export async function linkCheck({ path = '' } = {}) {
  if (!path) return { ok: false, error: 'path 必填（待检查的文件或目录）' };
  const links = await checkLinks({ file: path, text: readTextSafe(path) });
  return { ok: true, count: links.length, penalty: sumLinkPenalty(links), findings: links };
}

/**
 * 拼接产物作用域撞名检查。
 *
 * 缺省取项目自己声明的产物清单（`package.json` 的 `dshScopeCheck.files`）——
 *   不猜文件名，否则「哪些文件是拼接产物」会散成两处判断（调用方 + package.json）。
 * @param {{repo?: string, files?: string|string[], prefix?: string, allowlist?: string|string[], topLevelMustBeEmpty?: boolean}} [options]
 * @returns {{ok: boolean, count?: number, violations?: number, policySources?: string[], reports?: object[], lines?: string[], error?: string}}
 */
export function scopeCheck({ repo = '', files = '', prefix = '', allowlist = [], topLevelMustBeEmpty } = {}) {
  const repoRoot = resolve(String(repo || process.cwd()));
  let targets = (Array.isArray(files) ? files : splitList(files)).map((file) => resolve(repoRoot, file));
  if (!targets.length) {
    const policy = readProjectScopePolicy(join(repoRoot, 'package.json'));
    const base = policy.configPath ? dirname(policy.configPath) : repoRoot;
    targets = policy.files.map((file) => resolve(base, file));
    if (!targets.length) {
      return { ok: false, error: `未指定 files，且 ${join(repoRoot, 'package.json')} 未声明 dshScopeCheck.files` };
    }
  }
  const result = runScopeCheck({
    files: targets,
    prefix: String(prefix || ''),
    allowlist: Array.isArray(allowlist) ? allowlist : splitList(allowlist),
    ...(typeof topLevelMustBeEmpty === 'boolean' ? { topLevelMustBeEmpty } : {}),
  });
  const lines = result.policySources.map((source) => `策略来源：${source}`);
  for (const report of result.reports) {
    const rel = report.file.startsWith(`${repoRoot}/`) ? report.file.slice(repoRoot.length + 1) : report.file;
    if (report.ok) {
      lines.push(`✔ ${rel}：${(report.declarations || []).length} 个声明，无同帧重名`);
      continue;
    }
    lines.push(`✗ ${rel}：`);
    for (const violation of report.violations || []) lines.push(`    - ${violation}`);
  }
  const violationCount = result.reports.reduce((sum, report) => sum + (report.violations || []).length, 0);
  return {
    ok: result.ok,
    count: result.reports.length,
    violations: violationCount,
    policySources: result.policySources,
    reports: result.reports,
    lines,
  };
}

/**
 * 注释豁免标注（add / remove / list / check）。
 *
 * 底层是 `lib/exempt/tool.js`（真实改文件/校验生效），本函数只做 action 分派与参数归一化；
 *   未知 action 返回 `{ ok: false, error }` 而不是抛错——工具层要把这句错误原样给 AI 看。
 * @param {{action?: string, repo?: string, path?: string, line?: number|string, scope?: string, rule?: string, marker?: string, reason?: string, dryRun?: boolean}} [options]
 * @returns {Promise<object>}
 */
export async function exemptAction({
  action = '', repo = '', path = '', line, scope = '', rule = '', marker = '', reason = '', dryRun = false,
} = {}) {
  const tool = await import('./exempt/tool.js');
  const repoPath = String(repo || process.cwd());
  const wantDryRun = dryRun === true;
  if (action === 'add') {
    return tool.addExempt({ repoPath, path, line, scope, rule, marker, reason, dryRun: wantDryRun });
  }
  if (action === 'remove') return tool.removeExempt({ repoPath, path, marker, dryRun: wantDryRun });
  if (action === 'list') return tool.listExempt({ repoPath });
  if (action === 'check') return tool.checkExempt({ repoPath });
  return { ok: false, error: `未知 action：${action || '(空)'}（add/remove/list/check）` };
}
