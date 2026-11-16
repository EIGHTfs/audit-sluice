/**
 * 本包自己的配置文件（**审计配置的唯一归属**）
 *
 * 「怎么审」的开关（扫描范围 / 文件数上限 / 禁用规则包 / 权重覆盖）归本包，
 *   由本包自己读盘；宿主只说「审一下这个仓库」并传调用上下文（可见性、临时豁免）。
 *   宿主一旦替本包保存这些值，两个包就在共享一份配置。
 *
 * 位置解析（首个存在者生效，都不存在 = 全部走内置默认）：
 *   1. `AUDIT_SLUICE_HOME` 环境变量指定的目录（显式覆盖，测试/多环境用）
 *   2. `$DSH_HOME/audit-sluice/config.json`（装在 DSH 环境里）
 *   3. `~/.audit-sluice/config.json`（**没有 DSH 也要能用**——审计包不是 DSH 插件）
 *
 * 支持键（其余键忽略并记一条 note，不让拼错的键假装生效）：
 *   scanScope       'diff' | 'full'   扫描范围（缺省 diff）
 *   maxScanFiles    >=0 的数字        全量扫描文件上限（0 = 不限；缺省 3000）
 *   disabledSlots   string[]          禁用的规则包
 *   weightOverrides object            质量维度权重覆盖（{ 维度名: weight }）
 *
 * **刻意不支持 ruleOrder**：规则加载层把「显式数组」当**白名单**用（`loadRuleFiles`
 *   里非 null 即按清单加载），把「顺序」当数组传进去会让清单外的规则包被静默丢弃。
 *   宁可没有这个旋钮，也不提供一个看起来能用、实则丢规则的旋钮。
 *
 * 宿主遗留配置（**不静默丢弃**）：本包自己没配某项时，读宿主同环境下的
 *   `$DSH_HOME/git-push/config.json` 里的审计键作兜底，并在 `notes` 里标注来源。
 *   落盘迁移由显式命令完成（`audit-sluice config --migrate`），跑审计时不偷偷写文件。
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 配置文件里认的键 → 用途（顺序即 help 里的展示顺序）。 */
export const CONFIG_KEYS = Object.freeze(['scanScope', 'maxScanFiles', 'disabledSlots', 'weightOverrides']);

/** 宿主遗留的审计键 → 本包键名（一次性迁移来源，只读不写）。 */
const LEGACY_KEY_MAP = Object.freeze({
  auditScanScope: 'scanScope',
  maxScanFiles: 'maxScanFiles',
  auditDisabledSlots: 'disabledSlots',
  weightOverrides: 'weightOverrides',
});

/** 内置默认值（三处必须有同一个数字：这里的 maxScanFiles 与 cli.mjs 的 DEFAULT_MAX_SCAN_FILES）。 */
export const CONFIG_DEFAULTS = Object.freeze({
  scanScope: 'diff',
  maxScanFiles: 3000,
  disabledSlots: Object.freeze([]),
  weightOverrides: Object.freeze({}),
});

/**
 * 配置目录候选（按优先级；不存在的候选由调用方跳过）。
 * @param {{env?:object, home?:string}} [o]
 * @returns {string[]}
 */
export function configDirCandidates({ env = process.env, home = '' } = {}) {
  const out = [];
  const explicitHome = String(env.AUDIT_SLUICE_HOME || '').trim();
  if (explicitHome) out.push(explicitHome);
  const dshHome = String(env.DSH_HOME || '').trim();
  if (dshHome) out.push(join(dshHome, 'audit-sluice'));
  out.push(join(home || homedir(), '.audit-sluice'));
  return out;
}

/**
 * 生效的配置文件路径（首个存在的候选；都不存在返回 null = 用内置默认）。
 * @param {{env?:object, home?:string}} [o]
 * @returns {string|null}
 */
export function resolveConfigFile({ env = process.env, home = '' } = {}) {
  for (const dir of configDirCandidates({ env, home })) {
    const file = join(dir, 'config.json');
    if (existsSync(file)) return file;
  }
  return null;
}

/** 写配置时的目标路径（不需要已存在：取第一个候选目录）。 */
export function configWriteTarget({ env = process.env, home = '' } = {}) {
  const [first] = configDirCandidates({ env, home });
  return join(first, 'config.json');
}

/** 宿主遗留配置路径（一次性迁移来源）。 */
export function legacyHostConfigFile({ env = process.env } = {}) {
  const dshHome = String(env.DSH_HOME || '').trim();
  return dshHome ? join(dshHome, 'git-push', 'config.json') : '';
}

function readJsonSafe(file) {
  try {
    if (!file || !existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null; // 坏 JSON 当「没配」处理：审计不能因为配置文件写坏就跑不了
  }
}

/**
 * 只保留合法取值（键级校验；不合法的值退回内置默认并记 note）。
 * @param {object} raw 配置文件原文
 * @param {string} sourceLabel 来源描述（写进 note）
 * @param {string[]} notes 收集器
 * @returns {object} 合法键值
 */
function sanitize(raw, sourceLabel, notes) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key)) {
      notes.push(`${sourceLabel} 里的键「${key}」不是本包配置项，已忽略`);
    }
  }
  if (raw.scanScope !== undefined) {
    if (raw.scanScope === 'diff' || raw.scanScope === 'full') out.scanScope = raw.scanScope;
    else notes.push(`${sourceLabel} 的 scanScope 只接受 diff|full，收到 ${JSON.stringify(raw.scanScope)}，已按默认 ${CONFIG_DEFAULTS.scanScope}`);
  }
  if (raw.maxScanFiles !== undefined) {
    const n = Number(raw.maxScanFiles);
    if (Number.isFinite(n) && n >= 0) out.maxScanFiles = n;
    else notes.push(`${sourceLabel} 的 maxScanFiles 需要非负数字，收到 ${JSON.stringify(raw.maxScanFiles)}，已按默认 ${CONFIG_DEFAULTS.maxScanFiles}`);
  }
  if (raw.disabledSlots !== undefined) {
    if (Array.isArray(raw.disabledSlots)) out.disabledSlots = raw.disabledSlots.map((s) => String(s).trim()).filter(Boolean);
    else notes.push(`${sourceLabel} 的 disabledSlots 需要字符串数组，已按默认（不禁用）`);
  }
  if (raw.weightOverrides !== undefined) {
    if (raw.weightOverrides && typeof raw.weightOverrides === 'object' && !Array.isArray(raw.weightOverrides)) out.weightOverrides = raw.weightOverrides;
    else notes.push(`${sourceLabel} 的 weightOverrides 需要对象（{ 维度名: weight }），已按默认（默认权重表）`);
  }
  return out;
}

/**
 * 载入生效配置（本包配置 → 宿主遗留键兜底 → 内置默认）。
 * @param {{env?:object, home?:string}} [o]
 * @returns {{values: object, source: string, legacyFrom: string, notes: string[]}}
 */
export function loadConfig({ env = process.env, home = '' } = {}) {
  const notes = [];
  const file = resolveConfigFile({ env, home });
  const own = sanitize(readJsonSafe(file), file ? `配置文件 ${file}` : '', notes);
  let legacyFrom = '';
  const merged = { ...own };
  // 只有「本包没配」的键才看遗留配置：一旦用户在本包配了，旧键不再有话语权
  const missing = CONFIG_KEYS.filter((key) => merged[key] === undefined);
  if (missing.length) {
    const legacyFile = legacyHostConfigFile({ env });
    const legacyRaw = readJsonSafe(legacyFile);
    if (legacyRaw) {
      const translated = {};
      for (const [legacyKey, ownKey] of Object.entries(LEGACY_KEY_MAP)) {
        if (legacyRaw[legacyKey] !== undefined && missing.includes(ownKey)) translated[ownKey] = legacyRaw[legacyKey];
      }
      const usable = sanitize(translated, `宿主遗留配置 ${legacyFile}`, notes);
      const picked = Object.keys(usable);
      if (picked.length) {
        legacyFrom = legacyFile;
        for (const key of picked) merged[key] = usable[key];
        notes.push(`本次沿用宿主遗留配置 ${legacyFile} 里的 ${picked.join(' / ')}；`
          + `建议执行 audit-sluice config --migrate 落到本包配置后删掉旧键`);
      }
    }
  }
  const values = { ...CONFIG_DEFAULTS, ...merged };
  return {
    values,
    source: file || (legacyFrom ? 'legacy' : 'default'),
    legacyFrom,
    notes,
  };
}
