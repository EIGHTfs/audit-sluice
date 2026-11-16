/**
 * 包内路径常量
 *
 * 只提供 `PLUGIN_ROOT`（本包根目录）——它是「相对包根定位随包资源」的唯一出处
 *   （扩展规矩脚本目录、lint 适配器、预处理入口都用它拼路径，避免各处 handwrite 相对路径）。
 *
 * 边界：本包只跑本地 git 动词（log / archive / ls-files），不需要任何凭据，
 *   也不该知道宿主的配置目录在哪。凭据读取与宿主配置目录属于宿主能力。
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 本包根目录（`<pkg>/lib/core/config.js` → `lib/core` → `lib` → `<pkg>`）。 */
export const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
