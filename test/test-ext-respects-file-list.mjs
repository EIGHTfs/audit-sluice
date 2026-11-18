// 审计扩展（scripts/audit-ext/*.mjs）必须尊重主引擎的文件集
//
// 事故形态：ext 脚本自己 readdirSync 全仓递归、只跳 SKIP_DIRS ⇒
//   .auditignore / .gitignore / scope=changed 对它全部无效。
//   实测：被 gitignore 忽略的上游源码快照目录被扫出 4 个 blocker，拦住一次纯文档改动。
//
// 修复后契约：
//   · 传 opts.files ⇒ 只扫这些文件（与主引擎同一语义）
//   · 不传 ⇒ 退回全仓递归（独立调用本脚本的场景）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runAuditExt } from '../lib/engine/ext-runner.js';

/** 造一个会被 dsh/ctx-service-not-injected 命中的插件入口。 */
const BAD_PLUGIN = `
export async function apply(ctx) {
  ctx.logger.info('x');
  ctx.skills.list();
}
`;

test('ext 传 files ⇒ 只扫列出的文件（被排除的目录不报）', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'ext-files-'));
  try {
    mkdirSync(join(repo, 'src'), { recursive: true });
    mkdirSync(join(repo, 'vendor'), { recursive: true });
    writeFileSync(join(repo, 'src', 'ok.mjs'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'vendor', 'bad.mjs'), BAD_PLUGIN);

    // 只给 src/ok.mjs：vendor/bad.mjs 不该被扫
    const onlyGiven = await runAuditExt(repo, { files: ['src/ok.mjs'] });
    assert.equal(onlyGiven.length, 0, 'files 之外的文件不该被扫（这就是 gitignore/auditignore 生效的路径）');

    // 给上 vendor/bad.mjs 才报
    const withVendor = await runAuditExt(repo, { files: ['src/ok.mjs', 'vendor/bad.mjs'] });
    assert.ok(withVendor.length > 0, 'files 里列出的坏文件必须照常报');
    assert.ok(withVendor.every((f) => f.file.startsWith('vendor/')), '报出的应只有 vendor 那个');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('ext 不传 files ⇒ 退回全仓递归（独立调用场景保持可用）', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'ext-all-'));
  try {
    mkdirSync(join(repo, 'vendor'), { recursive: true });
    writeFileSync(join(repo, 'vendor', 'bad.mjs'), BAD_PLUGIN);
    const all = await runAuditExt(repo, {});
    assert.ok(all.length > 0, '不传 files 时应照旧全仓扫');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('ext 传空数组 files ⇒ 等同不传（不误判为「什么都不扫」）', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'ext-empty-'));
  try {
    mkdirSync(join(repo, 'vendor'), { recursive: true });
    writeFileSync(join(repo, 'vendor', 'bad.mjs'), BAD_PLUGIN);
    const empty = await runAuditExt(repo, { files: [] });
    assert.ok(empty.length > 0, '空数组应退回全仓（否则配置漏传会静默漏审）');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
