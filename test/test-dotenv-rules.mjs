// .env 槽位规则测试（dotenv/unquoted-hash）
//
// 目标：值未加引号且含 `#` ⇒ dotenv 把 # 后当行内注释，值被静默截断。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dotenvUnquotedHashLines, isDotenvFile } from '../lib/checks/dotenv.js';

test('未加引号且含 # ⇒ 命中', () => {
  const text = 'API_KEY=abc#def';
  const hit = dotenvUnquotedHashLines(text, '.env');
  assert.equal(hit.size, 1);
  assert.ok(hit.has(1));
});

test('已加双引号 ⇒ 不命中（引号保护了 #）', () => {
  assert.equal(dotenvUnquotedHashLines('API_KEY="abc#def"', '.env').size, 0);
});

test('已加单引号 ⇒ 不命中', () => {
  assert.equal(dotenvUnquotedHashLines("API_KEY='abc#def'", '.env').size, 0);
});

test('整行注释 ⇒ 不命中', () => {
  assert.equal(dotenvUnquotedHashLines('# COMMENT=abc#def', '.env').size, 0);
});

test('值里没有 # ⇒ 不命中', () => {
  assert.equal(dotenvUnquotedHashLines('API_KEY=abcdef', '.env').size, 0);
});

test('export 前缀也要认', () => {
  assert.equal(dotenvUnquotedHashLines('export API_KEY=abc#def', '.env').size, 1);
});

test('空行与无等号行 ⇒ 不命中', () => {
  const text = ['', 'just-a-word', '  ', 'A=1'].join('\n');
  assert.equal(dotenvUnquotedHashLines(text, '.env').size, 0);
});

test('多行引号串的中间行不误判', () => {
  const text = [
    'CERT="-----BEGIN-----',
    'abc#def',
    '-----END-----"',
  ].join('\n');
  assert.equal(dotenvUnquotedHashLines(text, '.env').size, 0, '引号未闭合期间的行属同一值，不该判');
});

test('多行串结束后的行照常判', () => {
  const text = [
    'CERT="a',
    'b"',
    'KEY=x#y',
  ].join('\n');
  const hit = dotenvUnquotedHashLines(text, '.env');
  assert.equal(hit.size, 1);
  assert.ok(hit.has(3));
});

test('文件名判定：只认 .env 系列', () => {
  assert.equal(isDotenvFile('.env'), true);
  assert.equal(isDotenvFile('.env.local'), true);
  assert.equal(isDotenvFile('.env.production'), true);
  assert.equal(isDotenvFile('config.env'), true);
  assert.equal(isDotenvFile('env.js'), false, 'env.js 不是 dotenv 文件');
  assert.equal(isDotenvFile('environment.txt'), false);
  assert.equal(isDotenvFile(''), false);
});

test('非 .env 文件一律不判（即使内容形似）', () => {
  assert.equal(dotenvUnquotedHashLines('API_KEY=abc#def', 'src/config.js').size, 0,
    'config.js 里这行是 JS 代码，不是 dotenv');
  assert.equal(dotenvUnquotedHashLines('API_KEY=abc#def', '').size, 0, '没有文件名时不判');
});
