# 青枫漫剧 · 后续版本迭代路线图(v12.171 →)

> 制定于 2026-07-11(当前 v12.170)。三源综合:memory 迭代余项 × 竞品联网核实(2026-07)× 代码库审计(20 缺口带证据)。
> 竞品关键结论:Kling 3.0(Elements 3.0/Omni Audio/multi-shot 6镜)、Seedance 2.5(30s+50参考素材)、Vidu Q3(16s 原生音视频,阅文主力)、SkyReels V4(开源第一)、TikTok Drama Center(AI 短剧分账月超 $200 万)、**Sora 2 API 2026-09-24 退役**。

## Batch A · 安全与止血(P0,先行)

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.171 | 安全双修:public/test-buttons.html 明文演示密码移除(该页对外可访问!)+ lib/db.ts 无条件 seed demo 账号加环境开关;.env.example 补 14+ 缺失 env | S |
| v12.172 | 预算护栏全覆盖:assertBudget 现只盖 create-stream/series 两口,**pipeline-worker/regenerate-shot/批量补渲全绕过**;统一进 orchestrator 生成入口 + pendingCostCny 从固定 ¥6 改按「镜数 × 引擎单价表」动态估 | M |
| v12.173 | Sora 退役迁移:veo.service modelChain 含 sora 系(2026-09-24 API 退役),从默认链摘除、文档标注迁移路径(Veo 3.1/Kling 3.0) | S |

## Batch B · 引擎代差补齐(竞品驱动,核心批)

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.174 | Kling 3.0 参数升级:model_name 探测(kling-v1→2.1-master/3.0)、duration 枚举扩展(15s)、4K/60fps 参数透传;live 验收一条片 | M |
| v12.175 | Kling Elements 3.0 Subject Binding:锁角 3-9 图 → elements 参数(现有 KLING_ELEMENTS=1 通道升 3.0 语义,@Element 标注,多角色 3+ 不混脸);与草图锁正交叠加 | M |
| v12.176 | Kling multi-shot 场景序列:同场景连续镜(transition=continuous 链/正反打)合并 1 次 multi-shot 调用(≤6 镜)——省 API 次数 + 模型级空间连续性 | L |
| v12.177 | Seedance 2.5 接入(qingyuntop doubao-seedance-pro 待评通道):50 参考素材全剧锚定 PoC + 30s 长镜;若达标可replace逐镜草图锁的部分场景 | M |
| v12.178 | Vidu Q3 通道(qingyuntop viduq3 待评):16s 原生音视频+口型,作为**对白镜专用引擎**(路由:有 dialogue 的镜优先 Q3);Kling Omni Audio 同批评估 | M |

## Batch C · 一致性与量产工业化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.179 | 口型语种修正:ko/ru lipsync 现错映射到 'en' viseme(口型-发音严重不匹配)→ 短修标 none 诚实降级,长修接多语 lipsync provider | S→M |
| v12.180 | 字幕字体跨平台:subtitle-burn 硬编码 PingFang SC(macOS 专有,Linux 烧韩/俄字幕炸)→ 按语种选 Noto 系 + SUBTITLE_FONT env | S |
| v12.181 | 跨集一致性传播:season onSettle → 当集角色锚/styleBible/末帧写 series 级表 → 下集 CreatePipelineInput 自动注入(对标天工「一处修改全剧同步」) | L |
| v12.182 | 百集并行断点续跑:season-orchestrator 池状态驻内存(崩溃全丢)→ season_batch_jobs 表持久化 + /resume 端点 | L |
| v12.183 | 多模态角色锚:2-3s 已过审视频片段作角色参考(Kling Elements 收 8s 参考视频/Seedance 混合输入),锁「动态特征」(步态/表情习惯) | M |

## Batch D · 成片质量与本土化深化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.184 | 类型化 BGM 自动选择 + BPM 卡点:beat-detect 补 BPM 估算、BGM 卡点对齐率(现 0%)治理、用户自定义 BGM 上传口 | M |
| v12.185 | 速度曲线(speed ramp):六档固定变速 → Clip.speedCurve 关键帧 + timeline 速度控件 + ffmpeg setpts 表达式插值 | M |
| v12.186 | UI i18n 扩语种:Locale 仅 4 种而管线支持 9 种;补 ko/ru 文案包,normalizeLocale 未知语种回退 en(现回退 zh-CN,非中文用户看全中文 UI) | M |
| v12.187 | 一键多语版:成片级「出海翻译管线」(剧本翻译 → 字幕重排 → TTS 重配 → recompose),对标行业 2.7 元/集翻译成本 | L |

## Batch E · 发布与商业化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.188 | 出海发布包深化:TikTok Drama Center 打包(分集+元数据+封面+定价建议;Q1 AI 短剧分账月超 $200 万)+ YouTube Shorts 直发完善 | M |
| v12.189 | 国内平台 OAuth 直发:抖音开放平台 video.create / B站 preupload(现除 YouTube 全是 manual 降级适配器);OAuth PKCE 用户授权存 token | L |
| v12.190 | 成本下钻:/api/projects/[id]/cost(cost_log × rollupByEngine)+ 项目页成本折叠面板 + 团队按 userId 聚合导出 CSV | M |

## Batch F · 工程债清理与平台化

| 版本 | 标题 | 量级 |
|---|---|---|
| v12.191 | 媒体清理与仓库瘦身:data/ 已 3.5GB 无定时清理 → cron cleanup(media 30d/composed·exports 7d);tracked 二进制 ~101MB → LFS/CDN 迁移 | M |
| v12.192 | 门面与死代码:README H1 版本号 postversion 脚本自动同步(治本);performance.ts 空 stub 处置;email SES 静默失败改 fail-fast | S |
| v12.193 | genre shot-pack Skills 化:ad-factory 模式泛化为「题材镜头包」(悬疑/甜宠/古装各一套 shot 语法+BGM+节奏模板),对标 Miora Skills | M/L |
| v12.194 | 小说长文本摄取增强:story-intake 升级「AI 问书」式抽取(人物关系/技能设定/高光情节),对标阅文「5 分钟理解百万字」 | L |

## v13 方向(批次外,需产品决策)

- **专属 LoRA 一致性档**:行业顶尖 97% 一致性 = IP-Adapter FaceID v2 + 专属 LoRA(30-50 图微调);做「角色 LoRA 训练」付费档,与草图锁/Elements 组成三级一致性体系
- **SkyReels V4 本地渲染档**:开源第一(T2V with Audio),接为低成本批量引擎,与 Kling/Vidu 分层
- **ControlNet 硬锁**:草图锁从软参考升级 Canny/IP-Adapter 硬约束(fal.ai 托管 ComfyUI 端点)
- **团队协作**(阅文已有):项目多人编辑/审批流
- **平台化 vs 工具**:阅文 ToonScroll 证明「工具→平台」是终局,分发/分账模块是否自建待定

> 执行约定:每版本照旧 tsc 0 + 单测 + live 验收(涉引擎必真跑)+ VERSIONS.md + push;每批次末跑一轮对抗评审;大版本同步 GitHub/ModelScope 门面。
