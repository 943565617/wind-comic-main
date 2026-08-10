/**
 * 持久媒体落盘目录(v12.124.0)。
 *
 * 病根:TTS 音频(minimax persistHexAudioToFile)/ 生成图像(orchestrator persistBase64ToFile)
 * 此前落 os.tmpdir()(macOS `/var/folders/...`)。macOS 每隔几天 GC 临时目录 → recompose / 复看时
 * serve-file 404(配音丢失、分镜图裂)。e2e 保温杯片实测 voiceover 404 复发(HTTP 404 /var/folders/...)。
 * 改落 `data/media/<kind>/` 持久目录(与 data/composed、data/covers 同级,已 gitignore),跨会话存活。
 *
 * 纯路径逻辑可单测:目录必在 cwd/data/media 下,绝不落 tmpdir。serve-file 路由已加此前缀白名单。
 */
import path from 'path';
import fs from 'fs';

/** 返回持久媒体子目录(自动 mkdir);kind 常用 'audio' | 'images',其它字符串按需扩展。 */
export function persistentMediaDir(kind: string): string {
  const safe = String(kind || 'misc').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(process.cwd(), 'data', 'media', safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 生成持久媒体文件的完整路径(不写盘,仅拼名)。 */
export function persistentMediaPath(kind: string, filename: string): string {
  return path.join(persistentMediaDir(kind), filename);
}
