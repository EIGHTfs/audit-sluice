/**
 * 对外三形态契约（批 B）：library / CLI / manifest。
 *
 * 为什么单独一组：拆包后本包**被别人调用**（宿主插件、MCP、外部脚本）。
 *   一旦三形态行为不一致（CLI 判的与 library 判的不同、manifest 说的与端点不符），
 *   故障表现是「按文档调用却不生效」，最难查。所以这里把三形态钉在同一份实现上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { audit, AuditInputError, assertRepoPath } from '../lib/index.js';
import { getPreprocessManifest, preprocessManifest } from '../lib/manifest.js';
import { parseGateArgs, parseSubcommand, runGateAudit, EXIT_FAILED } from '../cli.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli.mjs');

/**
 * 跑一次 CLI，返回 `{ status, stdout, stderr }`。
 * 为什么不直接用 execFileSync：**有 blocker 时它 exit 1**（这是契约本身），
 *   execFileSync 会当成异常抛出 ⇒ 拿不到 stdout，测试变成「无法验证契约」。
 */
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status ?? -1, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

/** 造一个含 1 条 blocker 的临时仓库（触发词拼接，避免本文件自身命中规则）。 */
function makeBlockerRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'as-api-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), '# demo\n');
  writeFileSync(join(dir, 'src', 'bad.js'), `// ${['用', '户', '原', '话'].join('')}：契约测试\nexport const bad = 1;\n`);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

test('② manifest 形状符合契约：endpoints 五条 + actions 含 audit/manifest，且与实现同源', () => {
  const manifest = preprocessManifest;
  assert.equal(manifest.id, 'audit');
  assert.equal(manifest.label, '审计');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(manifest.endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`), [
    'GET audit', 'GET rule-slots', 'GET rule-detail', 'POST toggle-rule', 'GET exempt-hint',
  ], '端点清单就是宿主该挂的五条（顺序固定，便于宿主比对）');
  for (const endpoint of manifest.endpoints) assert.ok(endpoint.desc, `端点 ${endpoint.path} 缺描述`);
  const actionNames = manifest.actions.map((action) => action.action);
  // 批 D1 后清单扩容：审计/报告 + 四个按需查询能力 + 自描述
  assert.deepEqual(actionNames, ['audit', 'io_scan', 'link_check', 'scope_check', 'exempt_hint', 'manifest']);
  const auditAction = manifest.actions[0];
  const flags = auditAction.params.map((param) => param.flag);
  for (const required of ['repo', 'scope', 'visibility', 'exemptPaths', 'exemptReason', 'rulesetDir', 'weights', 'compact', 'json']) {
    assert.ok(flags.includes(required), `audit 动作声明缺参数 ${required}`);
  }
  // 深拷贝：改返回值不能污染共享常量
  const copy = getPreprocessManifest();
  copy.endpoints.length = 0;
  assert.equal(preprocessManifest.endpoints.length, 5, 'getPreprocessManifest 必须返回副本');
});

test('② CLI `manifest --json`：stdout 单行 JSON，与 library 导出同源', () => {
  const out = execFileSync(process.execPath, [CLI, 'manifest', '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out.trim());
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(preprocessManifest)), 'CLI 输出的清单必须等于库里的常量');
  assert.equal(out.trim().split('\n').length, 1, 'stdout 必须只有一行 JSON');
});

test('④ library 接口可 import 并返回契约字段（含 blocked / exempt）', async () => {
  const dir = makeBlockerRepo();
  try {
    const result = await audit({ repoPath: dir, scope: 'full', visibility: 'public', exemptPaths: ['README.md'], exemptReason: '样本' });
    for (const key of ['ok', 'scope', 'summary', 'quality', 'findings', 'blocked', 'sampleExemptCount', 'files', 'engine']) {
      assert.ok(key in result, `library 返回缺字段 ${key}`);
    }
    assert.equal(typeof result.sampleExemptCount, 'number', 'sampleExemptCount 必须是数字（解释 blocker 与 blocked 差值）');
    assert.equal(result.ok, false, '有 blocker 应 ok:false');
    assert.ok(result.blocked.length >= 1, 'blocked 应非空');
    assert.equal(typeof result.summary.blocker, 'number', 'summary 是引擎原始统计');
    assert.ok(result.quality.score > 0);
    assert.equal(result.engine.id, 'builtin');
    assert.deepEqual(result.exempt.files, ['README.md']);
    assert.match(String(result.exempt.note), /临时豁免/, 'exempt.note 由预处理 renderResult 提供');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('④ library 私有库：blocked 为空但 privateExempt 带 note（只报告不拦截）', async () => {
  const dir = makeBlockerRepo();
  try {
    const result = await audit({ repoPath: dir, scope: 'full', visibility: 'private' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.blocked, []);
    assert.equal(result.privateExempt.visibility, 'private');
    assert.ok(result.privateExempt.blockedCount >= 1, '要能回答「本来有几条会拦」');
    assert.match(String(result.privateExempt.note), /private-repo-report-only/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('④ 输入校验：路径不存在 / 不是目录 → AuditInputError（CLI 映射 exit 2）', async () => {
  assert.throws(() => assertRepoPath('/definitely/not/here'), AuditInputError);
  assert.throws(() => assertRepoPath(join(ROOT, 'package.json')), /不是目录/);
  assert.throws(() => assertRepoPath(''), /缺少 repo/);
  await assert.rejects(() => audit({ repoPath: '/definitely/not/here' }), AuditInputError);
});

test('④ 输入校验：非 git 目录 + scope=diff → 明确报错（不再静默退化成全量）', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'as-plain-'));
  try {
    mkdirSync(join(plain, 'src'), { recursive: true });
    writeFileSync(join(plain, 'src', 'a.js'), 'export const a = 1;\n');
    await assert.rejects(
      () => audit({ repoPath: plain, scope: 'diff' }),
      /不是 git 仓库：无法取改动集/,
      'diff 需要 git；非 git 目录必须报错而不是把「本次改动」偷偷换成「整仓」',
    );
    // full 仍然支持（审计普通目录是合法用法）
    const full = await audit({ repoPath: plain, scope: 'full' });
    assert.equal(full.scope, 'full');
    assert.equal(full.ok, true);
  } finally { rmSync(plain, { recursive: true, force: true }); }
});

test('③ CLI 契约：子命令解析、--visibility 三值、--exempt-paths', () => {
  assert.deepEqual(parseSubcommand(['manifest', '--json']), { command: 'manifest', argv: ['--json'] });
  assert.deepEqual(parseSubcommand(['audit', '--repo', 'x']), { command: 'audit', argv: ['--repo', 'x'] });
  assert.deepEqual(parseSubcommand(['--repo', 'x']), { command: 'audit', argv: ['--repo', 'x'] }, '无子命令时默认 audit（批 A 写法仍可用）');

  const opts = parseGateArgs(['--repo', '/tmp/x', '--visibility', 'private', '--exempt-paths', 'a.js,b.js', '--exempt-reason', '样本']);
  assert.equal(opts.visibility, 'private');
  assert.deepEqual(opts.exemptPaths, ['a.js', 'b.js']);
  assert.equal(opts.exemptReason, '样本');
  assert.equal(parseGateArgs(['--repo', '/tmp/x']).visibility, 'unknown', '缺省 unknown（与 public 同口径）');
  assert.throws(() => parseGateArgs(['--repo', '/tmp/x', '--visibility', 'privte']), /只接受 private\|public\|unknown/);
});

test('③ CLI 实跑：exit 0/1/2 三态 + stdout 单行 JSON', () => {
  const dir = makeBlockerRepo();
  const clean = mkdtempSync(join(tmpdir(), 'as-clean-'));
  try {
    mkdirSync(join(clean, 'src'), { recursive: true });
    writeFileSync(join(clean, 'src', 'ok.js'), 'export const ok = 1;\n');

    const blockedRun = runCli(['--repo', dir, '--scope', 'full', '--json']);
    assert.equal(blockedRun.status, 1, '有 blocker ⇒ exit 1');
    assert.equal(blockedRun.stdout.trim().split('\n').length, 1, 'stdout 必须只有一行 JSON');
    const blockedJson = JSON.parse(blockedRun.stdout.trim());
    assert.equal(blockedJson.ok, false);
    assert.ok(Array.isArray(blockedJson.blocked) && blockedJson.blocked.length >= 1, 'CLI 输出必须含 blocked 结论');
    assert.equal(typeof blockedJson.sampleExemptCount, 'number', 'CLI 输出必须带 sampleExemptCount');

    // 私有库：CLI 也要给 ok:true + privateExempt
    const privateRun = runCli(['--repo', dir, '--scope', 'full', '--visibility', 'private', '--json']);
    assert.equal(privateRun.status, 0, '私有库只报告不拦截 ⇒ exit 0');
    const privateJson = JSON.parse(privateRun.stdout.trim());
    assert.equal(privateJson.ok, true);
    assert.deepEqual(privateJson.blocked, []);
    assert.equal(privateJson.privateExempt.visibility, 'private');

    // 路径不存在 ⇒ exit 2（独立包不能「传错路径还成功」）
    const missing = runCli(['--repo', '/definitely/not/here', '--json']);
    assert.equal(missing.status, EXIT_FAILED, `不存在路径应 exit ${EXIT_FAILED}`);
    assert.match(missing.stderr, /参数错误：仓库路径不存在/, '错误信息必须说清是路径问题');

    // 干净目录 ⇒ exit 0
    const cleanRun = runCli(['--repo', clean, '--scope', 'full', '--json']);
    assert.equal(cleanRun.status, 0);
    assert.equal(JSON.parse(cleanRun.stdout.trim()).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(clean, { recursive: true, force: true });
  }
});

test('三形态一致：CLI 的 runGateAudit 与 library audit 对同一仓库结论相同', async () => {
  const dir = makeBlockerRepo();
  try {
    const viaLibrary = await audit({ repoPath: dir, scope: 'full', visibility: 'public' });
    const viaCli = await runGateAudit(parseGateArgs(['--repo', dir, '--scope', 'full']));
    assert.equal(viaCli.ok, viaLibrary.ok);
    assert.deepEqual(viaCli.blocked, viaLibrary.blocked, 'CLI 与 library 的拦截结论必须逐条相同');
    assert.deepEqual(viaCli.summary, viaLibrary.summary);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
