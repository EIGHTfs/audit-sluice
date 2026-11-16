/**
 * Git 执行层 · 进程调用
 *
 * 职责：统一的 git 子进程入口（runGit 走 execFileSync 取 stdout；gitRaw 取原始结果
 *   含 exitCode/stderr，供 git archive 这类需要原始字节的场景）。
 * 所有 git 调用都经过此模块，便于统一超时与错误规整，避免各调用点各写一份。
 *
 * 边界（刻意收窄）：审计只跑**本地** git 动词（`log` / `archive` / `ls-files` 等），
 *   不 fetch、不 clone、不 push —— 所以这里**没有**镜像前缀注入、没有传输看门狗、
 *   没有宿主插件包装器的直通开关。审计不需要网络与凭据，那些能力不属于本包。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { delimiter as pathDelimiter, join } from 'node:path';

/* ───────────────────────── git 可执行文件解析 ───────────────────────── */

/**
 * 解析 git 可执行文件路径（**不假设** PATH 里一定有 git）。
 *
 * 为什么要显式解析：服务账号的 PATH 常常没有 git，直接 `execFileSync('git', ...)` 只会
 *   抛 ENOENT，被上层规整成「空 stdout」，而空 stdout 在审计里另有含义（无改动 / 非仓库）
 *   —— 于是真因被掩盖成一条误导性结论。显式解析 + 明确的缺失提示能把「环境问题」
 *   与「仓库问题」分开。
 * 优先级：`DSH_GIT_BIN` 环境变量（本机 git 位置覆盖）→ PATH 各目录 → 常见绝对路径。
 */
/**
 * 组装「到哪找 git」的搜索计划（纯函数，便于跨平台单测）。
 *
 * 为什么单独成函数：Windows 的 PATH 用 `;` 分隔、可执行名是 `git.exe`，与 POSIX 不同；
 *   把分隔符与候选名收在一处，才不会出现「在 Windows 上把整串 PATH 当成一个目录」这种
 *   伪装成环境问题的误报。
 * @param {string} pathValue PATH 值
 * @param {{delimiter?:string, platform?:string}} [opts] 可注入，便于单测
 * @returns {{dirs:string[], names:string[]}}
 */
export function gitSearchPlan(pathValue, { delimiter = pathDelimiter, platform = process.platform } = {}) {
  const dirs = String(pathValue || '')
    .split(delimiter)
    .map((d) => d.trim().replace(/[\\/]+$/, ''))
    .filter(Boolean);
  const names = platform === 'win32' ? ['git.exe', 'git.cmd', 'git.bat', 'git'] : ['git'];
  return { dirs, names };
}

let _gitBin;
export function resolveGitBin() {
  if (_gitBin !== undefined) return _gitBin;
  const envBin = process.env.DSH_GIT_BIN;
  if (envBin) { _gitBin = envBin; return _gitBin; }
  // PATH 分隔符与可执行名按平台取（Windows 是 ';' 与 git.exe）
  const { dirs, names } = gitSearchPlan(process.env.PATH || '');
  for (const dir of dirs) {
    for (const name of names) {
      const p = join(dir, name);
      try { if (existsSync(p) && statSync(p).isFile()) { _gitBin = p; return _gitBin; } } catch { /* 继续找 */ }
    }
  }
  // 不写死任何安装位置：写死路径换机/换平台必失效，还可能悄悄指向错的可执行文件。
  _gitBin = '';
  return _gitBin;
}

/** 找不到 git 时的统一提示（调用方原样上抛，不再伪装成业务错误）。 */
export const GIT_MISSING_MSG = '找不到 git 可执行文件：请把 git 加入 PATH，或用 DSH_GIT_BIN 指定其绝对路径';

/* ───────────────────────── 基础：git 执行 ───────────────────────── */

/** git 全局配置参数（每次调用前置；safe.directory 防「不信任目录」误伤工作区，quotepath 保持路径可读）。 */
export const GIT_GLOBAL_ARGS = ['-c', 'safe.directory=*', '-c', 'core.filemode=false', '-c', 'core.quotepath=false'];

/** 统一 git 执行（数组参数，零注入面；stderr 保留供排障）。 */
export function runGit(args, { cwd = '', timeoutMs = 120_000, env = {} } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return { ok: false, stdout: '', stderr: GIT_MISSING_MSG };
  try {
    const out = execFileSync(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e?.stderr || e?.message || e).trim() };
  }
}

/**
 * git 原始字节通道（gitRaw 语义）：stdout 保留 Buffer，供 blob 原始内容读取。
 * ⚠️ 读 blob 必须走本函数：runGit 的 utf8 解码 + trim 会损坏非 UTF-8 字节与末尾换行，
 *   让算出来的 blob sha 与本地不一致。
 * @returns {{status: number|null, stdout: Buffer, stderr: Buffer, error?: string}}
 */
export function gitRaw(args, { cwd = '', timeoutMs = 600_000 } = {}) {
  const base = GIT_GLOBAL_ARGS;
  const bin = resolveGitBin();
  if (!bin) return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: GIT_MISSING_MSG };
  try {
    const r = spawnSync(bin, cwd ? base.concat(['-C', cwd], args) : base.concat(args), {
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    return { status: r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0), ...(r.error ? { error: String(r.error.message || r.error) } : {}) };
  } catch (e) {
    return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: String(e?.message || e) };
  }
}
