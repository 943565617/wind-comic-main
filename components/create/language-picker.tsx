'use client';

/**
 * 制作语言选择器(v12.165.0,共享组件)—— 创作工坊/短视频等制作入口复用。
 * listSupportedLanguages 驱动(中英日韩俄西法德葡);选定语种随请求下达
 * → Writer 剧本铁律 + TTS 配音语种(ttsReliable 的语种配音即该语种)。
 * 「⭐ 设为默认」把当前选择写进系统默认语言,其它入口自动继承。
 */
import { useState } from 'react';
import { listSupportedLanguages } from '@/lib/language-detect';
import { getSystemLanguage, setSystemLanguage, type SystemLanguage } from '@/lib/system-language';

interface Props {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  hint?: string;
}

export function LanguagePicker({ value, onChange, label = '制作语言 · 台词/旁白/配音语种', hint }: Props) {
  const [savedTick, setSavedTick] = useState(false);
  const isSystemDefault = getSystemLanguage() === (value as SystemLanguage);
  return (
    <div className="cinema-card-hi p-3" data-testid="language-picker">
      <div className="flex items-center justify-between mb-1.5">
        <div className="cinema-mono text-[10px] opacity-50 tracking-wider">{label}</div>
        <button
          type="button"
          title="设为系统默认语言(各制作入口自动继承)"
          onClick={() => { setSystemLanguage(value as SystemLanguage); setSavedTick(true); setTimeout(() => setSavedTick(false), 1500); }}
          className={`cinema-mono text-[9px] ${isSystemDefault ? 'text-[var(--cinema-amber)]' : 'opacity-40 hover:opacity-90'}`}
        >
          {savedTick ? '✓ 已设为默认' : isSystemDefault ? '⭐ 系统默认' : '☆ 设为默认'}
        </button>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none focus:border-[var(--cinema-amber)] transition-colors"
      >
        <option value="auto">自动检测(按创意文字)</option>
        {listSupportedLanguages().map((l) => (
          <option key={l.code} value={l.code}>
            {l.nativeName}{l.ttsReliable ? '' : ' · 配音降级'}
          </option>
        ))}
      </select>
      <div className="cinema-mono text-[9px] opacity-40 mt-1.5">{hint || '仅中/英有原生口型;日/韩/俄等语种剧本+字幕+配音全链,口型近似'}</div>
    </div>
  );
}
