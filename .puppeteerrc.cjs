/**
 * Puppeteer 配置 —— 跳过 postinstall 的 Chrome 下载。
 *
 * 为什么:puppeteer 的 postinstall 会从 Google CDN 拉 Chrome,国内网络必卡
 * (实测空转 33 分钟:CPU 仅 23 秒、无任何网络连接,纯超时重试)。
 *
 * 为什么安全:
 *   · 生产用法 app/api/projects/[id]/pull-sheet/route.ts 本就是
 *     puppeteer.launch({ channel: 'chrome' }) —— 优先系统 Chrome;
 *   · CI 的 E2E 用 Playwright(npx playwright install chrome),与 puppeteer 无关;
 *   · 全仓无任何测试真正启动 puppeteer(v12-152 那处仅为测试名字符串)。
 *
 * 注意:puppeteer v19 起**不再读 npmrc 的 puppeteer_skip_download**,
 * 只认本文件或 PUPPETEER_SKIP_DOWNLOAD 环境变量(见 getConfiguration.ts:117-124,150)。
 */
module.exports = { skipDownload: true };
