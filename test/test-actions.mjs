/**
 * 按需查询类 action（批 D1）：io_scan / link_check / scope_check / exempt_hint。
 *
 * 这四条能力原先住在宿主插件的工具层，拆包后归本包。测试盯两件事：
 *   ① 返回字段与宿主工具**逐个相同**（宿主直接把结果转给 AI，少一个字段就少一条判断依据）；
 *   ② manifest 声明与实际实现同源（声明了却调不通 = 文档骗人）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { auditHistory, auditReport, exemptAction, ioScan, linkCheck, scopeCheck } from '../lib/actions.js';
import { preprocessManifest } from '../lib/manifest.js';
import { GROUP_BY_KEYS } from '../lib/report.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeTmp(prefix) { return mkdtempSync(join(tmpdir(), `as-act-${prefix}-`)); }

test('io_scan：字段 ok/root/total/sync/byRisk/items，按 risk 分档计数', async () => {
  const dir = makeTmp('io');
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'sync.js'), "import { readFileSync } from 'node:fs';\nexport const a = readFileSync('x', 'utf8');\n");
    writeFileSync(join(dir, 'src', 'async.js'), "import { readFile } from 'node:fs/promises';\nexport const b = await readFile('x', 'utf8');\n");
    const result = await ioScan({ root: dir });
    assert.deepEqual(Object.keys(result).sort(), ['byRisk', 'items', 'ok', 'root', 'sync', 'total']);
    assert.equal(result.ok, true);
    assert.equal(result.total, result.items.length);
    assert.equal(result.sync, result.items.filter((item) => item.type === 'sync').length);
    assert.equal(Object.values(result.byRisk).reduce((sum, n) => sum + n, 0), result.total, 'byRisk 各档之和应等于总数');
    // 缺 repo 必须报错（宿主工具靠这句错误提示 AI 补参数）
    assert.equal((await ioScan({ root: '' })).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('link_check：字段 ok/count/penalty/findings（只报有问题的 URL；无 URL ⇒ 三项归零）', async () => {
  const dir = makeTmp('link');
  try {
    // 说明：`link_check` 检的是 **URL**（http/https，靠探测判定可达性），本地相对路径 md 链接不在此列。
    //   所以这里只用「无 URL 文档」验证字段与归零语义——真实 URL 探测需要网络，
    //   由包内 link-check 单测用注入 fetcher 覆盖（不把网络依赖带进契约测试）。
    writeFileSync(join(dir, 'doc.md'), '# t\n\n纯文本，没有 URL。\n');
    const result = await linkCheck({ path: join(dir, 'doc.md') });
    assert.deepEqual(Object.keys(result).sort(), ['count', 'findings', 'ok', 'penalty']);
    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
    assert.equal(result.penalty, 0);
    assert.deepEqual(result.findings, []);
    assert.equal((await linkCheck({ path: '' })).ok, false, '缺 path 必须报错而不是静默返回 ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scope_check：字段 ok/count/violations/policySources/reports/lines，缺省读 package.json 声明', () => {
  const dir = makeTmp('scope');
  try {
    writeFileSync(join(dir, 'bundle.js'), 'var a = 1;\nfunction f() {}\n');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dshScopeCheck: { files: ['bundle.js'] } }));
    const result = scopeCheck({ repo: dir });
    assert.deepEqual(Object.keys(result).sort(), ['count', 'lines', 'ok', 'policySources', 'reports', 'violations']);
    assert.equal(result.ok, true);
    assert.equal(result.count, 1, '缺省按 package.json 的 dshScopeCheck.files 取到 1 个文件');
    assert.ok(Array.isArray(result.lines) && result.lines.length > 0);
    // 没有 files 也没有声明 ⇒ 明确报错（不猜文件名）
    const empty = makeTmp('scope-empty');
    try {
      writeFileSync(join(empty, 'package.json'), '{}');
      const failed = scopeCheck({ repo: empty });
      assert.equal(failed.ok, false);
      assert.match(String(failed.error), /未声明 dshScopeCheck\.files/);
    } finally { rmSync(empty, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('exempt_hint：add/list/check 走通；未知 action 返回错误而不是抛异常', async () => {
  const dir = makeTmp('exempt');
  try {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.js'), 'var x = 1;\n');
    const added = await exemptAction({ action: 'add', repo: dir, path: 'src/a.js', line: 1, rule: 'readability/max-lines' });
    assert.equal(added.ok, true);
    assert.match(readFileSync(join(dir, 'src', 'a.js'), 'utf8'), /dsh-skip-/, '应真的写入豁免标记');
    const listed = await exemptAction({ action: 'list', repo: dir });
    assert.equal(listed.ok, true);
    assert.ok(listed.total >= 1);
    assert.deepEqual(Object.keys(listed).sort(), ['items', 'ok', 'total']);
    const checked = await exemptAction({ action: 'check', repo: dir });
    assert.equal(typeof checked.ok, 'boolean');
    const unknown = await exemptAction({ action: 'nope', repo: dir });
    assert.equal(unknown.ok, false);
    assert.match(String(unknown.error), /未知 action/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('auditReport：字段与宿主 code_audit 工具逐个相同（含 GROUP_BY_KEYS）', async () => {
  const dir = makeTmp('report');
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# demo\n');
    writeFileSync(join(dir, 'src', 'a.js'), 'export function run() {\n  console.log("x");\n  return 1;\n}\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
    const report = await auditReport({ repo: dir, scope: 'full' });
    for (const key of ['ok', 'scope', 'files', 'summary', 'quality', 'exemptStats', 'blocked', 'groupByTypes', 'apiGuide', 'slotStats', 'findings']) {
      assert.ok(key in report, `auditReport 缺字段 ${key}`);
    }
    assert.deepEqual(report.groupByTypes, GROUP_BY_KEYS, '聚合维度从 report 层取，不在宿主另写一份');
    assert.equal(typeof report.apiGuide, 'string');
    assert.match(report.apiGuide, /审计：/, 'apiGuide 是给 AI 复制去查明细的指引');
    const summaryOnly = await auditReport({ repo: dir, scope: 'full', summaryOnly: true });
    assert.equal('findings' in summaryOnly, false, 'summaryOnly 不返回明细（大仓场景）');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('manifest 声明了 4 个新 action，且每个都有 params 与 desc', () => {
  const names = preprocessManifest.actions.map((action) => action.action);
  for (const expected of ['io_scan', 'link_check', 'scope_check', 'exempt_hint']) {
    assert.ok(names.includes(expected), `manifest 应声明 ${expected}`);
    const action = preprocessManifest.actions.find((item) => item.action === expected);
    assert.ok(action.desc, `${expected} 缺 desc`);
    assert.ok(Array.isArray(action.params) && action.params.length > 0, `${expected} 缺 params`);
    assert.ok(action.params.every((param) => param.flag && param.desc), `${expected} 的参数缺 flag/desc`);
  }
});

test('auditHistory：缺 repo 报错；真实 git 仓库能产出报告目录', async () => {
  assert.equal((await auditHistory({ repo: '' })).ok, false);
  const dir = makeTmp('history');
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
    writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-qm', 'one'], { cwd: dir });
    const result = await auditHistory({ repo: dir, outDir: join(dir, 'reports') });
    assert.equal(typeof result.ok, 'boolean');
    assert.ok(result.reportDir, 'auditHistory 必须回报告目录（宿主据此回显）');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
