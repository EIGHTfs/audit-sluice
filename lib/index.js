/**
 * audit-sluice 对外门面（library 形态）
 *
 * 三种形态同一份实现：library（本文件）/ CLI（cli.mjs）/ manifest（lib/manifest.js）。
 * 宿主只该 import 这里，**不要**直接 import lib/engine/** 或 lib/preprocess/** ——
 * 那些是内部结构，可随实现调整；本文件导出的符号才是稳定面。
 *
 * 返回值字段（契约）：
 * ```
 * { ok, scope, summary, quality, findings, blocked, exempt, privateExempt, files, engine, specFallback? }
 * ```
 *   - `summary.blocker`：引擎**原始** blocker 数（问题规模）
 *   - `blocked`：叠加四类豁免后的**拦截结论**（门禁依据）——两者刻意不同，别合并
 *   - `ok`：`blocked.length === 0`（私有库恒 true：只报告不拦截）
 */

import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { GIT_GLOBAL_ARGS, resolveGitBin, GIT_MISSING_MSG } from './core/exec.js';
import { resolve } from 'node:path';

import { computeBlocked } from './blocked.js';
import { getAdapter } from './preprocess/adapters/builtin.js';
import { renderPreprocessResult } from './preprocess/index.js';
import { runPreprocess } from './preprocess/index.js';
import { score } from './preprocess/score.js';
import { getPreprocessManifest, preprocessManifest } from './manifest.js';

export { preprocessManifest, getPreprocessManifest };
export { computeBlocked } from './blocked.js';
// 按需查询类动作（宿主工具直接转给 AI，字段必须稳定）
export { auditHistory, auditReport, exemptAction, ioScan, linkCheck, scopeCheck } from './actions.js';
// 聚合查询维度清单：宿主 HTTP 端点与工具提示共用同一份（不要在宿主里再写一份）
export { GROUP_BY_KEYS, MAX_MSG_PREVIEW, blockedOf, exemptStatsOf } from './report.js';
export { runPreprocess } from './preprocess/index.js';
export { getAdapter, builtinAdapter, ADAPTERS } from './preprocess/adapters/builtin.js';
export { getBuiltinScoreSpec } from './engine/score-spec.js';

/**
 * 入参错误（路径不存在 / 不是目录 / 参数非法）。
 *
 * 为什么单独一个错误类型：CLI 要把「输入错」映射成 exit 2，与「审计执行失败」区分开；
 *   调用方也能靠 `instanceof` 决定是否重试（输入错重试无意义）。
 */
export class AuditInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditInputError';
  }
}

/**
 * 校验仓库路径：必须是**存在的目录**。
 *
 * 为什么独立包必须硬校验：宿主侧调用时路径由宿主保证有效，独立 CLI 却是被外部人/外部
 *   程序调用 —— 传错路径还返回 `ok:true` 等于「静默放行」，比报错危险得多
 *   （同 `exemptPaths` 传错名的老毛病：不报错、功能悄悄失效）。
 * @param {string} repoPath
 * @returns {string} 解析后的绝对路径
 */
export function assertRepoPath(repoPath) {
  if (!repoPath || typeof repoPath !== 'string') throw new AuditInputError('缺少 repo 参数（仓库绝对路径）');
  const abs = resolve(repoPath);
  if (!existsSync(abs)) throw new AuditInputError(`仓库路径不存在：${abs}`);
  let stat;
  try { stat = statSync(abs); } catch (e) { throw new AuditInputError(`仓库路径不可访问：${abs}（${e?.message || e}）`); }
  if (!stat.isDirectory()) throw new AuditInputError(`仓库路径不是目录：${abs}`);
  return abs;
}

/**
 * 判断目录是否在 git 工作区内（`diff` 范围的前提）。
 *
 * 为什么必须显式判：`diff` 的语义是「本次改了什么」，非 git 目录根本给不出改动集。
 *   gitpush 内部调用时路径由宿主保证，静默退化成全量还能接受；独立包不行 ——
 *   用户敲 `--scope diff` 得到的却是「整仓全量结果」，语义被悄悄换掉（同「传错参数不报错」一个病）。
 * @param {string} repoPath
 * @returns {boolean}
 */
export function isInsideGitWorkTree(repoPath) {
  // 必须带上 GIT_GLOBAL_ARGS（含 safe.directory=*）：否则「仓库属主与运行用户不同」的
  //   常见部署形态下 git 会报 dubious ownership，这里被判成「不是 git 仓库」，
  //   于是 --scope diff 莫名其妙地拒绝工作（引擎内其它 git 调用都带这组参数，唯独本判断漏了）。
  const bin = resolveGitBin();
  if (!bin) throw new Error(GIT_MISSING_MSG);
  try {
    const out = execFileSync(bin, [...GIT_GLOBAL_ARGS, '-C', repoPath, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return String(out).trim() === 'true';
  } catch { return false; }
}

/**
 * 审计一个仓库（library 入口）。
 *
 * @param {object} options
 * @param {string} options.repoPath 仓库绝对路径（必填）
 * @param {'diff'|'full'} [options.scope] 审计范围（默认 diff）
 * @param {'private'|'public'|'unknown'} [options.visibility] 可见性（默认 unknown ⇒ 与 public 同口径）
 * @param {string[]} [options.exemptPaths] 本次临时豁免的相对路径
 * @param {string} [options.exemptReason] 豁免理由（仅回显）
 * @param {string} [options.rulesetDir] 自定义规则包目录
 * @param {object} [options.weights] 维度权重覆盖
 * @param {boolean} [options.compact] 拦截清单 message 是否截断（默认 true；报告形态传 false 取完整）
 * @param {object} [options.engine] 引擎适配器对象（测试/第三方注入；缺省内置）
 * @param {string} [options.adapterId] 引擎 id（按注册表查）
 * @param {number} [options.maxScanFiles] 文件数上限
 * @param {string[]} [options.slots] 只加载这些规则包
 * @param {string[]} [options.disabledSlots] 禁用这些规则包
 * @returns {Promise<object>} 见文件头契约
 */
export async function audit(options = {}) {
  const repoPath = assertRepoPath(options.repoPath);
  const scope = options.scope === 'full' ? 'full' : 'diff';
  const visibility = String(options.visibility || 'unknown');
  const adapter = options.engine || getAdapter(options.adapterId);
  // `diff` 需要 git：非 git 目录不再静默退化成全量（那会把「本次改动」变成「整仓」）
  if (scope === 'diff' && !isInsideGitWorkTree(repoPath)) {
    throw new AuditInputError(`不是 git 仓库：无法取改动集（${repoPath}）；如只想全量扫描请用 --scope full`);
  }

  const pre = await runPreprocess(repoPath, {
    ...options,
    adapter,
    scope,
  });

  const auditResult = pre.audit || {};
  // 评分上下文与宿主提交门禁**逐项一致**：只给 files / dimFileCounts / dimRuleCounts。
  //   刻意**不传 docsScore**：宿主门禁（原 audit-gate）就是不带它的，多给一项会让分数变化
  //   （实测「文档」维度 8.71 → 2.5，因为 docsScore 是加分项而门禁不吃这一项）。
  //   要带 docsScore 的场景（历史报告）由调用方自己调 lib/preprocess/score.js。
  const quality = score(pre.findings, pre.scoreSpec, options.weights || {}, {
    files: pre.files,
    dimFileCounts: auditResult.dimFileCounts,
    dimRuleCounts: auditResult.dimRuleCounts,
  });

  const verdict = computeBlocked(pre.findings, {
    repoPath,
    exemptPaths: options.exemptPaths,
    exemptReason: options.exemptReason,
    visibility,
    ...(options.compact === false ? { compact: false } : {}),
  });

  // 回显文案（豁免 note / 私有库 note）由**预处理自己的 renderResult** 提供：
  //   措辞属审计语义，本包内单一来源；缺失也不崩（无 note 字段即可）。
  const rendered = renderPreprocessResult({
    repoPath,
    audit: { summary: auditResult.summary, quality, findings: pre.findings, scope: auditResult.scope, files: pre.files },
    blocked: verdict.blocked,
    // 「原始 blocker 数 - 实际拦截数」的差值来源：示例目录（.samples）豁免的条数。
    //   用户看到「36 个 blocker 但只拦 29 个」时，这个字段就是答案（同 privateExempt.blockedCount 一族）。
    sampleExemptCount: verdict.sampleExemptCount,
    ...(verdict.exempt ? { exempt: verdict.exempt } : {}),
  }, {});
  if (verdict.exempt) verdict.exempt.note = rendered?.notes?.exempt;
  if (verdict.privateExempt) verdict.privateExempt.note = rendered?.notes?.privateExempt;

  return {
    ok: verdict.ok,
    scope: auditResult.scope || scope,
    summary: auditResult.summary,
    quality,
    findings: pre.findings,
    blocked: verdict.blocked,
    // 「原始 blocker 数 - 实际拦截数」的差值来源：示例目录（.samples）豁免的条数。
    //   用户看到「36 个 blocker 但只拦 29 个」时，这个字段就是答案（同 privateExempt.blockedCount 一族）。
    sampleExemptCount: verdict.sampleExemptCount,
    ...(verdict.exempt ? { exempt: verdict.exempt } : {}),
    ...(verdict.privateExempt ? { privateExempt: verdict.privateExempt } : {}),
    files: pre.files,
    engine: { id: pre.adapter, visibility },
    ...(quality.specFallback ? { specFallback: true, specFallbackReason: quality.specFallbackReason } : {}),
  };
}

/** 默认导出：`import auditSluice from 'audit-sluice'` 时拿到主函数（附清单属性）。 */
export default audit;
