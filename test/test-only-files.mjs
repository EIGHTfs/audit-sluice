/**
 * 「只审清单内文件」回归（PREPROCESS_ONLY_FILES_FILE / opts.onlyFiles）
 *
 * 修的缺陷：在此之前 `paths` 只影响 `git add`，审计照样扫整棵工作树的 diff ⇒
 *   「我要提交 A 的文件」会被「B 正在写、暂时不合规的文件」拦住。并行开发时提交几乎跑不通，
 *   只能靠跳过门禁绕过（实测连续三次被别人的中间态卡住）。
 *
 * 本测试锁四件事：
 *   ① 没有清单 ⇒ 行为与改动前完全一致（这是其它宿主的依赖，不能动）
 *   ② 有清单 ⇒ 只审清单内文件，清单外文件的问题不出现
 *   ③ 空清单 ⇒ 审 0 个文件（**不是**「不限制范围」，否则宿主过滤出空集会退化成审全仓库）
 *   ④ 清单文件读不到 ⇒ 明确抛错（既不静默变全量、也不当成放行）
 *
 * 断言口径说明：这里刻意**不看严重度**（blocker/warning），只看「某文件是否被扫描并产出 finding」。
 *   同一个 `readability/max-function-length` 在引擎默认规则下是 warning，而在带自定义规则包的
 *   仓库里是 blocker —— 若断言 severity，本测试就变成在测「规则包配置」而不是「扫描范围」，
 *   换一个宿主环境就会假红（首版正是这么写的，已纠正）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditChanged } from '../lib/engine/orchestrate.js';
import { mkdtempTracked } from './helpers/tmp-dir.mjs';

/** 造一个必然被结构规则盯上的文件（函数体 60 行 > 阈值 50）。 */
function longFunctionSource(functionName) {
  const body = Array.from({ length: 60 }, (_, index) => `  const step${index} = ${index};`).join('\n');
  return `export function ${functionName}() {\n${body}\n  return 0;\n}\n`;
}

/** 建一个临时 git 仓库：两个未跟踪文件，一个是「有问题的」、一个是干净的。 */
function makeRepoWithNoisyFile() {
  const repoPath = mkdtempTracked('audit-only-files-');
  execFileSync('git', ['init', '-q'], { cwd: repoPath, stdio: 'ignore' });
  writeFileSync(join(repoPath, 'noisy.js'), longFunctionSource('oversizedFunction'));
  writeFileSync(join(repoPath, 'clean.js'), 'export const smallValue = 1;\n');
  return repoPath;
}

/** 在清单文件与环境变量之间切换，跑完恢复（避免污染同进程其它用例）。 */
async function withOnlyFiles(listText, repoPath, runner) {
  const previous = process.env.PREPROCESS_ONLY_FILES_FILE;
  const listPath = join(repoPath, '.only-files.txt');
  if (listText === null) delete process.env.PREPROCESS_ONLY_FILES_FILE;
  else {
    writeFileSync(listPath, listText);
    process.env.PREPROCESS_ONLY_FILES_FILE = listPath;
  }
  try {
    return await runner();
  } finally {
    if (previous === undefined) delete process.env.PREPROCESS_ONLY_FILES_FILE;
    else process.env.PREPROCESS_ONLY_FILES_FILE = previous;
  }
}

/** 被扫描到并产出了 finding 的文件集合（不区分严重度，理由见文件头）。 */
const reportedFilesOf = (result) => new Set((Array.isArray(result.findings) ? result.findings : []).map((finding) => finding.file));

test('无清单：行为与改动前一致，清单外文件的问题照常报出', async () => {
  const repoPath = makeRepoWithNoisyFile();
  const result = await withOnlyFiles(null, repoPath, () => auditChanged(repoPath, { scope: 'diff' }));

  assert.ok(result.files >= 2, `应扫描仓库里全部变动文件，实际 ${result.files}`);
  assert.ok(reportedFilesOf(result).has('noisy.js'), '没有清单时 noisy.js 的问题必须照常被报出');
});

test('有清单：只审清单内文件，清单外文件的问题不出现', async () => {
  const repoPath = makeRepoWithNoisyFile();
  const result = await withOnlyFiles('clean.js\n', repoPath, () => auditChanged(repoPath, { scope: 'diff' }));

  assert.equal(result.files, 1, '清单只含 clean.js，应只审 1 个文件');
  assert.ok(!reportedFilesOf(result).has('noisy.js'),
    '清单外的 noisy.js 不该出现——这正是「精确 paths 提交不被别人中间态拦住」的关键');
});

test('有清单且清单内就含问题文件：仍然照常报出（不是无条件放行）', async () => {
  const repoPath = makeRepoWithNoisyFile();
  const result = await withOnlyFiles('noisy.js\n', repoPath, () => auditChanged(repoPath, { scope: 'diff' }));

  assert.equal(result.files, 1);
  assert.ok(reportedFilesOf(result).has('noisy.js'), '自己文件里的问题必须照报，否则等于关掉门禁');
});

test('空清单：审 0 个文件，而不是退化成审全仓库', async () => {
  const repoPath = makeRepoWithNoisyFile();
  const result = await withOnlyFiles('', repoPath, () => auditChanged(repoPath, { scope: 'diff' }));

  assert.equal(result.files, 0, '空清单意味「本次没有要审的文件」，不能被当成「不限制范围」');
  assert.deepEqual([...reportedFilesOf(result)], []);
});

test('清单路径归一：容忍 ./ 前缀与反斜杠、CRLF，仍能对上 diff 里的仓库相对路径', async () => {
  const repoPath = makeRepoWithNoisyFile();
  // 宿主传过来的路径可能带 ./ 前缀、反斜杠或 CRLF（不同平台 join/写入的产物），必须归一后再比对
  const result = await withOnlyFiles('.\\clean.js\r\n', repoPath, () => auditChanged(repoPath, { scope: 'diff' }));

  assert.equal(result.files, 1, './ 前缀与 CRLF 不得导致清单匹配失败');
  assert.ok(!reportedFilesOf(result).has('noisy.js'));
});

test('opts.onlyFiles 优先于环境变量（library 调用方可直接给数组）', async () => {
  const repoPath = makeRepoWithNoisyFile();
  const result = await withOnlyFiles('noisy.js\n', repoPath,
    () => auditChanged(repoPath, { scope: 'diff', onlyFiles: ['clean.js'] }));

  assert.equal(result.files, 1);
  assert.ok(!reportedFilesOf(result).has('noisy.js'), 'opts.onlyFiles 应覆盖环境变量');
});

test('清单文件不可读：抛错，不静默退化成全量也不当成放行', async () => {
  const repoPath = makeRepoWithNoisyFile();
  const previous = process.env.PREPROCESS_ONLY_FILES_FILE;
  process.env.PREPROCESS_ONLY_FILES_FILE = join(repoPath, 'does-not-exist.txt');
  try {
    await assert.rejects(
      () => auditChanged(repoPath, { scope: 'diff' }),
      /PREPROCESS_ONLY_FILES_FILE/,
      '清单不可读必须抛出可诊断的错误',
    );
  } finally {
    if (previous === undefined) delete process.env.PREPROCESS_ONLY_FILES_FILE;
    else process.env.PREPROCESS_ONLY_FILES_FILE = previous;
  }
});
