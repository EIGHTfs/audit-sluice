/**
 * 拦截判定与豁免（批 B 核心）：`blocked` 是本包的**权威结论**。
 *
 * 这组测试盯四件事：
 *   ① 四类豁免的叠加顺序正确（示例目录 / 临时豁免 / 私有库 / 代码标记）；
 *   ② `summary.blocker`（引擎原始数）与 `blocked`（豁免后结论）**刻意不同**，不许合并；
 *   ③ `visibility: unknown` 与 `public` 同口径（保守拦截）——两包必须一致的约定；
 *   ④ 拦截清单的 message 截断、路径归一化等边界不回归。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeBlocked, MAX_MSG_PREVIEW, normalizeExemptPath, normalizeExemptPaths } from '../lib/blocked.js';

const blocker = (over = {}) => ({ file: 'src/a.js', line: 3, rule: 'documentation/comment-suspicious-detection', severity: 'blocker', message: '可疑注释'.repeat(60), ...over });
const warning = (over = {}) => ({ file: 'src/a.js', line: 9, rule: 'readability/max-lines', severity: 'warning', message: '太长', ...over });

test('① 公开库：blocker 全部计入 blocked，warning 不进；message 按 MAX_MSG_PREVIEW 截断', () => {
  const verdict = computeBlocked([blocker(), warning(), blocker({ file: 'src/b.js', line: 7 })], { repoPath: '.', visibility: 'public' });
  assert.equal(verdict.blocked.length, 2, '两条 blocker 都应进拦截清单');
  assert.equal(verdict.ok, false);
  assert.equal(verdict.blocked[0].message.length, MAX_MSG_PREVIEW, 'message 应截断到 MAX_MSG_PREVIEW');
  assert.deepEqual(Object.keys(verdict.blocked[0]).sort(), ['file', 'line', 'message', 'rule'], '清单只带四个字段（明细走聚合 API）');
  assert.equal(verdict.sampleExemptCount, 0);
});

test('① 示例目录豁免：`.samples` 下的 blocker 不拦（但仍计入 sampleExemptCount）', () => {
  const repo = mkdtempSync(join(tmpdir(), 'blocked-samples-'));
  try {
    mkdirSync(join(repo, '.samples'), { recursive: true });
    // 在 .samples 目录放 0 字节标记文件（引擎侧同样的口径）
    writeFileSync(join(repo, '.samples', '.samples'), '');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', '.samples'), '');
    const verdict = computeBlocked([
      blocker({ file: 'src/demo.js' }),      // src/ 里有 .samples 标记 ⇒ 豁免
      blocker({ file: 'lib/real.js' }),      // 无标记 ⇒ 照拦
    ], { repoPath: repo, visibility: 'public' });
    assert.equal(verdict.blocked.length, 1, '示例目录里的 blocker 应被豁免');
    assert.equal(verdict.blocked[0].file, 'lib/real.js', '非示例目录的 blocker 必须照拦');
    assert.equal(verdict.sampleExemptCount, 1, '豁免计数用于可观测（不是静默丢弃）');
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('① 临时豁免：exemptPaths 命中（含 blocker）即不拦，并回显 exempt 统计', () => {
  const verdict = computeBlocked([
    blocker({ file: 'src/a.js', rule: 'docs/x' }),
    blocker({ file: 'src/b.js', rule: 'docs/y' }),
    warning({ file: 'src/a.js', rule: 'docs/x' }),
  ], { repoPath: '.', visibility: 'public', exemptPaths: ['./src/a.js', 'src\\b.js'.replace(/\\/g, '/')], exemptReason: '本次基线' });
  assert.equal(verdict.blocked.length, 0, '两条 blocker 都在豁免清单里 ⇒ 不拦');
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.exempt.files.sort(), ['src/a.js', 'src/b.js'], '路径应归一化后回显');
  assert.equal(verdict.exempt.reason, '本次基线');
  assert.ok(verdict.exempt.count >= 2, 'count 是豁免文件命中的 finding 条数');
});

test('① 私有库：blocked 归零但 blockedCount 保留（降级而非忽略）', () => {
  const verdict = computeBlocked([blocker(), blocker({ file: 'src/b.js' })], { repoPath: '.', visibility: 'private' });
  assert.deepEqual(verdict.blocked, [], '私有库只报告不拦截 ⇒ 结论是不拦');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.privateExempt.visibility, 'private');
  assert.equal(verdict.privateExempt.blockedCount, 2, '必须能回答「私有库本来有几条会拦」');
});

test('③ unknown 与 public 同口径（保守拦截）——两包必须一致的约定', () => {
  const findings = [blocker(), warning()];
  const asPublic = computeBlocked(findings, { repoPath: '.', visibility: 'public' });
  const asUnknown = computeBlocked(findings, { repoPath: '.', visibility: 'unknown' });
  const asMissing = computeBlocked(findings, { repoPath: '.' }); // 不传 visibility
  assert.deepEqual(asUnknown.blocked, asPublic.blocked, 'unknown 必须与 public 判定完全相同');
  assert.deepEqual(asMissing.blocked, asPublic.blocked, '不传 visibility 等价于 unknown（保守）');
  assert.equal(asUnknown.ok, false);
  // 只有明确 private 才放松
  assert.equal(computeBlocked(findings, { repoPath: '.', visibility: 'private' }).ok, true);
});

test('② summary.blocker（引擎原始数）与 blocked（豁免后结论）刻意不同', () => {
  const findings = [blocker({ file: 'src/a.js' }), blocker({ file: 'src/b.js' })];
  const verdict = computeBlocked(findings, { repoPath: '.', visibility: 'public', exemptPaths: ['src/a.js'] });
  const rawBlockerCount = findings.filter((finding) => finding.severity === 'blocker').length;
  assert.equal(rawBlockerCount, 2, '引擎原始 blocker 数是 2（问题规模）');
  assert.equal(verdict.blocked.length, 1, '豁免后结论是 1（门禁依据）');
  assert.notEqual(rawBlockerCount, verdict.blocked.length, '两者刻意不同：合并会同时毁掉可观测性与豁免语义');
});

test('边界：路径归一化与空输入', () => {
  assert.equal(normalizeExemptPath('./src\\a.js'), 'src/a.js');
  assert.equal(normalizeExemptPath('  src/b.js  '), 'src/b.js');
  assert.equal(normalizeExemptPaths(['./a.js', '', 'b.js']).size, 2, '空值应被过滤');
  const empty = computeBlocked([], { repoPath: '.', visibility: 'public' });
  assert.deepEqual(empty.blocked, []);
  assert.equal(empty.ok, true);
  assert.equal(empty.exempt, undefined, '没有临时豁免时不产生 exempt 字段');
});
