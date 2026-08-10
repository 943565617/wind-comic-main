/**
 * 创作偏好跨会话记忆(v12.145.0,对标 Miora Agent Memory 第一步)。
 *
 * 病根:创作工坊的画风/画幅/运镜默认/剪辑风格/语言/草图锁每次新建都要重选。
 * localStorage 持久(零后端、本机隐私);纯函数 save/load 可测(注入 storage)。
 */
export interface CreatePrefs {
  style?: string;
  aspect?: string;
  cameraDefault?: string | null;
  editStyle?: string;
  scriptLanguage?: string;
  sketchLock?: boolean;
  savedAt?: string;
}

const KEY = 'windcomic.createPrefs.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function saveCreatePrefs(prefs: CreatePrefs, storage?: StorageLike): void {
  try {
    const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!st) return;
    st.setItem(KEY, JSON.stringify({ ...prefs, savedAt: new Date().toISOString() }));
  } catch { /* 存储满/隐私模式 → 静默 */ }
}

export function loadCreatePrefs(storage?: StorageLike): CreatePrefs | null {
  try {
    const st = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!st) return null;
    const raw = st.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p as CreatePrefs : null;
  } catch { return null; }
}
