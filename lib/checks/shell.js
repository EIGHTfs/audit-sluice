// Shell 脚本静态检查（shell 槽位精筛）
//
// 为什么单独一个文件：这类问题**跨行**（行尾续行符 + 下一行内容），
//   正则按行跑天然看不见，必须拿全文做行间关系判定。

/**
 * 找出「续行符 `\` 后紧跟注释」的行号。
 *
 * 错法（本规则目标）：
 *   VAR="value" \
 *   # 这是注释
 *   echo done
 *
 * 为什么是问题：`\` 让 shell 把下一行**当作本行的延续**。
 *   下一行是注释时，注释被并进命令（或让赋值提前结束），
 *   变量值不是你以为的那个，且**不报任何错** —— 静默错误，最难排查。
 *
 * 判定（逐行）：
 *   ① 本行去掉行尾空白后以 `\` 结尾（奇数个连续 `\`；偶数个是被转义的 `\` 本身，不是续行）
 *   ② 下一行 trim 后以 `#` 开头
 *
 * 排除（避免误报）：
 *   · heredoc 体内（`<<EOF ... EOF`）：那里的 `\` 与 `#` 都是字面文本
 *   · 单引号串内（`'...'` 里的 `\` 不是续行符）
 *   · 上一行末尾在双引号串内（`"..."` 未闭合时 `\` 可能是转义）
 *
 * @param {string} text 文件全文
 * @returns {Set<number>} 命中行号（1-based，指向**续行那一行**，因为问题出在它后面跟了注释）
 */
export function shellContinuationCommentLines(text) {
  const out = new Set();
  const lines = String(text || '').split('\n');
  const heredocRanges = findHeredocRanges(lines);

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (inRanges(i, heredocRanges)) continue;
    const cur = lines[i];
    // ① 行尾是续行符（奇数个连续反斜杠）
    const tail = cur.replace(/\s+$/, '');
    if (!tail.endsWith('\\')) continue;
    const m = tail.match(/\\+$/);
    if (!m || m[0].length % 2 === 0) continue; // 偶数个 = 转义的反斜杠，不是续行
    // ② 下一行是注释
    const next = lines[i + 1].trim();
    if (!next.startsWith('#')) continue;
    // ③ 排除单引号串内（粗略：本行单引号个数为奇数说明在串内）
    if ((countChar(cur, "'") % 2) === 1) continue;
    out.add(i + 1);
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
 * 找出 heredoc 体所在的行区间（含起止行）。
 *
 * 支持 `<<EOF` / `<<-EOF` / `<<'EOF'` / `<<"EOF"` 四种写法；
 *   `<<-` 允许结束符缩进（制表符），普通 `<<` 要求结束符在行首。
 * @param {string[]} lines
 * @returns {Array<[number, number]>} [start, end] 闭区间（0-based）
 */
function findHeredocRanges(lines) {
  const ranges = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (!m) continue;
    const dash = /<<-/.test(m[0]);
    const tag = m[2];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = dash ? lines[j].replace(/^\t+/, '') : lines[j];
      if (line.trim() === tag) {
        ranges.push([i, j]);
        i = j;
        break;
      }
    }
  }
  return ranges;
}

function inRanges(idx, ranges) {
  return ranges.some(([a, b]) => idx >= a && idx <= b);
}
