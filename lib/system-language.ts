/**
 * 系统默认制作语言(v12.165.0)—— 一处设定,各制作入口(创作工坊/系列批量/整季导入/短视频)
 * 默认继承;单次制作仍可覆盖。localStorage 本机持久,SSR 安全(服务端返回 'auto')。
 */
import type { TargetLanguage } from './language-detect';

const KEY = 'windcomic.systemLanguage.v1';

export type SystemLanguage = TargetLanguage | 'auto';

export function getSystemLanguage(): SystemLanguage {
  try {
    if (typeof localStorage === 'undefined') return 'auto';
    const v = localStorage.getItem(KEY) || 'auto';
    return (v as SystemLanguage) || 'auto';
  } catch { return 'auto'; }
}

export function setSystemLanguage(lang: SystemLanguage): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, lang);
  } catch { /* 隐私模式静默 */ }
}
