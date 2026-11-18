// .env 文件静态检查（dotenv 槽位精筛）
//
// 为什么单独一个槽位：.env 是**自有一套解析规则**的文件格式（不是 shell、不是 JSON），
//   混进 shell 槽位会被当成 shell 语法判（引号/展开规则都不一样）。

/**
 * 找出 `.env` 里「值未加引号且含 `#`」的行号。
 *
 * 错法（本规则目标）：
 *   API_KEY=abc#def
 *
 * 为什么是问题：dotenv 解析规则里 `#` 之后是**行内注释**，
 *   上面这行实际值是 `abc`（不是 `abc#def`）—— 值被静默截断，不报错。
 *   真实故障形态：密钥含 `#`（不少随机串有）⇒ 认证一直失败，查半天才发现值少了一截。
 *
 * 判定（逐行）：
 *   ① 去掉可选 `export ` 前缀后，行形如 `KEY=...`（KEY 是合法标识符）
 *   ② 值**不以** `'` 或 `"` 开头（未加引号）
 *   ③ 值里含 `#`
 *
 * 不命中：
 *   · 整行注释（`#` 开头）
 *   · 空行
 *   · 已加引号：`KEY="abc#def"` / `KEY='abc#def'`
 *   · 值里没有 `#`
 *   · 多行引号串的中间行（上一行引号未闭合）
 *
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号（1-based）
 */
export function dotenvUnquotedHashLines(text, filePath = '') {
  const out = new Set();
  // 只认 .env 系列文件：`.env` / `.env.local` / `.env.production` / `xxx.env`。
  //   为什么按文件名判而不是靠规则 exts：`.env.local` 的扩展名是 `local`，exts 匹配不到。
  if (!isDotenvFile(filePath)) return out;
  const lines = String(text || '').split('\n');
  let inMultiline = false; // 处于多行引号串内（值跨行）时跳过，避免把中间行误判

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    // 多行串内：只关心它何时闭合
    if (inMultiline) {
      if ((countChar(raw, '"') % 2) === 1 || (countChar(raw, "'") % 2) === 1) inMultiline = false;
      continue;
    }
    if (!line || line.startsWith('#')) continue; // 空行 / 整行注释

    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2];
    if (!value) continue;

    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // 已加引号：若本行引号未闭合，后续行属同一值，进入多行模式
      if ((countChar(value, quote) % 2) === 1) inMultiline = true;
      continue;
    }
    // 未加引号：含 # 就会被截断
    if (value.includes('#')) out.add(i + 1);
  }
  return out;
}

/** 统计字符出现次数（用于粗判引号是否闭合）。 */
function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}

/**
 * 判断是否 dotenv 系列文件。
 * 认：`.env`、`.env.local`、`.env.production`、`.env.example`、`config.env`
 * 不认：`env.js`、`environment.txt`
 * @param {string} filePath
 * @returns {boolean}
 */
export function isDotenvFile(filePath = '') {
  const base = String(filePath || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
  if (!base) return false;
  if (base === '.env') return true;
  if (base.startsWith('.env.')) return true;   // .env.local / .env.production
  if (base.endsWith('.env')) return true;      // config.env
  return false;
}
