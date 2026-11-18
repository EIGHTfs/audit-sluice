// Shell 槽位规则测试（shell/continuation-comment）
//
// 目标：续行符 `\` 后跟注释 → 变量赋值/参数列表静默错位。
// 这类问题**跨行**，正则按行跑看不见，全靠 lib/checks/shell.js 的行间判定。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shellContinuationCommentLines } from '../lib/checks/shell.js';

test('续行符后跟注释 ⇒ 命中（静默错误）', () => {
  const text = [
    'VAR="value" \\',
    '# 这是注释',
    'echo done',
  ].join('\n');
  const hit = shellContinuationCommentLines(text);
  assert.equal(hit.size, 1);
  assert.ok(hit.has(1), '指向续行那一行');
});

test('注释在完整命令之后 ⇒ 不命中（正确写法）', () => {
  const text = [
    'VAR="value"',
    '# 这是注释',
    'echo done',
  ].join('\n');
  assert.equal(shellContinuationCommentLines(text).size, 0);
});

test('下一行不是注释 ⇒ 不命中（正常续行）', () => {
  const text = [
    'echo a \\',
    '  b',
  ].join('\n');
  assert.equal(shellContinuationCommentLines(text).size, 0);
});

test('heredoc 体内的 \\ + # 不命中（字面文本）', () => {
  const text = [
    'cat <<EOF',
    'line with \\',
    '# not a comment',
    'EOF',
  ].join('\n');
  assert.equal(shellContinuationCommentLines(text).size, 0);
});

test('heredoc 结束后仍能正常检测', () => {
  const text = [
    'cat <<EOF',
    'body',
    'EOF',
    'VAR="x" \\',
    '# 注释',
  ].join('\n');
  assert.equal(shellContinuationCommentLines(text).size, 1, 'heredoc 之后的行要照常判');
  assert.ok(shellContinuationCommentLines(text).has(4));
});

test('偶数个反斜杠是转义不是续行 ⇒ 不命中', () => {
  const text = [
    'echo "path\\\\"',
    '# 注释',
  ].join('\n');
  assert.equal(shellContinuationCommentLines(text).size, 0);
});

test('单引号串内的 \\ 不是续行符 ⇒ 不命中', () => {
  const text = [
    "echo 'a \\",
    '# not a comment',
  ].join('\n');
  assert.equal(shellContinuationCommentLines(text).size, 0);
});

test('多个续行+注释全部命中（不止报第一个）', () => {
  const text = [
    'A="1" \\',
    '# c1',
    'B="2" \\',
    '# c2',
  ].join('\n');
  const hit = shellContinuationCommentLines(text);
  assert.equal(hit.size, 2);
  assert.ok(hit.has(1) && hit.has(3));
});
