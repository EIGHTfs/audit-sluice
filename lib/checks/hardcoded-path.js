// dsh-skip-i18n: 本文件为规则实现，输出文案硬编码中文为产品行为（无 i18n 需求）
/**
 * 检查层 · 硬编码绝对路径精筛（paths 槽位 / astConfirmKind: "hardcoded-abs-path"）
 *
 * 为什么需要精筛（正则做不到的两件事）：
 *   ① **可访问性判断**——同一个绝对路径在本机可能存在（说明是"这台机器的真实路径"，换机必失效）
 *      也可能不存在（别人机器/历史遗留写法），两者的处置不同，只有 fs 才能判断；
 *   ② **相对路径换算**——把绝对路径换算成相对该文件所在目录的路径（修复时的替换基准），
 *      供修复时直接替换；这需要文件路径上下文。
 *
 * 与正则的分工（引擎既有形态）：规则的 patterns 只做**初筛**（跨系统字面量形状），
 *   本模块给出**允许报出的行号集合**（allow 语义）+ 行号→详情（供 finding message 用）。
 *
 * 唯一实现声明：本模块是"硬编码绝对路径"检测的**唯一实现**——脚本（scripts/scan-hardcoded-paths.mjs）
 *   必须调用它，不得自带第二份 PATTERNS（同一事实两份实现 ⇒ 必然分叉）。
 */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, dirname, isAbsolute, join } from 'node:path';

/** 跨系统硬编码绝对路径的识别（只取"像绝对路径"的形状，避免把相对路径/URL 误判）。 */
const PATH_RES = [
  // Linux / macOS：/volume1 /home /Users /var /usr /opt /tmp /dev/shm /mnt /srv /etc /root /Applications /Volumes
  //   /dev/shm 只放精确特例：整个 /dev 下多是设备文件（/dev/null 等），放开会把它们当路径扫。
  /(?:^|["'`(\s=:])(\/(?:volume\d+|home|Users|var|usr|opt|tmp|dev\/shm|mnt|srv|etc|root|Applications|Volumes)\/[^\s"'`)\]},;]*)/g,
  // Windows：C:\ 或 C:/
  /(?:^|["'`(\s=:])([A-Za-z]:[\\/][^\s"'`)\]},;]*)/g,
  // UNC：\\server\share\...
  /(?:^|["'`(\s=:])(\\\\[A-Za-z0-9_.-]+\\[^\s"'`)\]},;]*)/g,
  // file:///...
  /(file:\/\/\/[^\s"'`)\]},;]*)/g,
];

/**
 * 命中里混入中文 / 全角标点 ⇒ 这是**散文**（说明文字、规则描述、注释里的举例），不是路径。
 * 实测两类误报都由它兜掉：
 *   ① 规则自己的描述文本被夹具引用：`/volume1/...，换机即失效）`（后面跟了中文逗号与全角括号）；
 *   ② 截图输出路径后紧跟全角括号：`/tmp/iwara-login-shots）`。
 * 真实路径不会含 CJK 或全角标点 ⇒ 直接丢弃该命中（不是"只警告"，是根本不报）。
 */
const PROSE_MIXED = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

/**
 * 判断某个绝对路径是否**跨机语义一致**，因此不该当硬编码问题报。
 *
 * 两类豁免（与 audit-rules-paths.yml 里 paths/hardcoded-absolute-path 的 exceptions 对应）：
 *   ① 临时目录：`os.tmpdir()` 是跨平台常量（Linux /tmp、macOS /var/folders/…、Windows %TEMP%），
 *      写它换机也照样能用 ⇒ 不是硬编码问题。**用 tmpdir() 而不是字面 '/tmp'**：
 *      后者在 macOS/Windows 上根本不是同一个目录，拿它判断等于只对 Linux 有效。
 *   ② 系统工具目录：多候选探测是 tool-self-detection 要求的正确做法，
 *      把它当硬编码拦等于逼项目只能依赖 PATH。
 *
 * 为什么必须有这条：规则注释早就写着「已排除临时目录与系统工具目录」，
 *   但实现从没落地 ⇒ `/tmp/cache` 被报 blocker（实测：4 行样本里 /tmp 那条被拦）。
 * @param {string} raw 命中的原始路径串
 * @returns {boolean} true = 合理路径，不该报
 */
function systemPathLiteralKind(raw) {
  const p = String(raw || '').replace(/\\/g, '/');
  if (!p) return '';
  // 临时目录字面量：语义跨机一致，但**字面量不跨平台** ⇒ 该用 os.tmpdir()
  if (/^\/(tmp|var\/tmp|dev\/shm)(\/|$)/.test(p)) return 'tmp';
  // 系统工具目录字面量：该用 process.execPath / which 探测 / 环境变量
  if (/^\/(usr\/(local\/)?(bin|sbin)|opt\/homebrew)(\/|$)/.test(p)) return 'tool';
  return '';
}

/**
 * 扫描文本里的硬编码绝对路径（引擎侧唯一实现）。
 * @param {string} text 文件全文
 * @param {string} filePath 文件路径（用于换算相对路径；缺省时不做换算）
 * @returns {Array<{line:number, raw:string, accessible:boolean, relative:string, os:string}>}
 */
export function hardcodedAbsPathHits(text, filePath = '', baseDir = '') {
  const hits = [];
  // 审计传进来的 file 可能是**相对审计根**的路径（如 src/sample.mjs）⇒ 必须用 repoPath 补成绝对路径，
  //   否则 relative('src', '/tmp/x') 会算出一串 ../../（实测踩到：message 里出现 ../../../../../../tmp/…）。
  const absFile = filePath ? (isAbsolute(filePath) ? filePath : join(String(baseDir || ''), filePath)) : '';
  const lines = String(text || '').split('\n');
  lines.forEach((line, i) => {
    PATH_RES.forEach((re, idx) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const raw = m[1];
        if (!raw) continue;
        if (PROSE_MIXED.test(raw)) continue; // 混入中文/全角标点 = 散文举例，不是路径（见 PROSE_MIXED 注释）
        // 系统标准路径字面量（/tmp、/usr/bin…）：语义跨机一致，但**字面量不跨平台**。
        //   不当「硬编码本机路径」拦（换机不会失效），但要报「应改用系统常量」——
        //   由 paths/system-path-literal 规则消费 systemKind 分流，避免两条规则重复报同一行。
        const systemKind = systemPathLiteralKind(raw);
        const accessible = existsSync(raw);
        hits.push({
          line: i + 1,
          raw,
          systemKind,
          accessible,
          // 可访问才换算：不可访问的路径（别人机器/已删除）无从确定基准，只提示不改写
          relative: accessible && absFile ? relative(dirname(absFile), raw).split('\\').join('/') : '',
          os: ['posix', 'windows', 'unc', 'file-url'][idx] || 'unknown',
        });
      }
    });
  });
  return hits;
}

/**
 * astConfirmKind: "hardcoded-abs-path" 的集合取值——**本机特有路径**的行号。
 *
 * 只收 systemKind 为空的命中：`/tmp`、`/usr/bin` 这类系统标准路径语义跨机一致，
 * 换机不会失效，不属"硬编码本机路径"；它们由 systemPathLiteralLines 交给另一条规则
 * （paths/system-path-literal）报「应改用系统常量」。两条规则按 kind 分流，同一行只报一次。
 */
export function hardcodedAbsPathLines(text, filePath = '', baseDir = '') {
  return new Set(
    hardcodedAbsPathHits(text, filePath, baseDir)
      .filter((h) => !h.systemKind)
      .map((h) => h.line),
  );
}

/**
 * astConfirmKind: "system-path-literal" 的集合取值——系统标准路径**字面量**的行号。
 *
 * 为什么单独成规则：写 `/tmp/cache` 换机照样能跑（不是硬编码失效问题），
 *   但**字面量不跨平台**（Windows 没有 /tmp）⇒ 该用 `os.tmpdir()`；
 *   写 `/usr/bin/node` 该用 `process.execPath` 或 which 探测。
 *   所以它是「可移植性建议」，severity 用 warning，不是 blocker。
 */
export function systemPathLiteralLines(text, filePath = '', baseDir = '') {
  return new Set(
    hardcodedAbsPathHits(text, filePath, baseDir)
      .filter((h) => h.systemKind)
      .map((h) => h.line),
  );
}

/** astConfirmKind: "hardcoded-abs-path" 的行号→详情（供 finding message：可访问者附相对路径）。 */
export function hardcodedAbsPathDetail(text, filePath = '', baseDir = '') {
  const out = new Map();
  for (const h of hardcodedAbsPathHits(text, filePath, baseDir)) {
    const prev = out.get(h.line);
    // 同一行多个路径时优先展示"可访问"的那条（可操作：能直接换成相对路径）
    if (!prev || (!prev.accessible && h.accessible)) out.set(h.line, h);
  }
  return out;
}

/** 人类可读的一句话说明（可访问 ⇒ 附相对路径；不可访问 ⇒ 仅警告）。 */
export function describeHardcodedAbsPath(hit) {
  if (!hit) return '硬编码绝对路径';
  return hit.accessible && hit.relative
    ? `硬编码绝对路径 ${hit.raw}（本机可访问）⇒ 建议改为相对路径 ${hit.relative}`
    : `硬编码绝对路径 ${hit.raw}（本机不可访问）⇒ 仅警告，无法换算相对路径`;
}
