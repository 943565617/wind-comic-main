# 硬伤加固路线图 v12.218 → v12.231

> 来源:2026-07-21 竞品视角对抗尽调(7 路攻击面 × 27 条软肋)。已逐行**核实校正**——剔除敌对方 3 处误报(model-scan/pull-sheet 实有鉴权、CRON 生产有 503 保护)、1 处数字错(音色 6 档非 4)。
> 排序原则:**止血成本低 × 杀伤面大 优先**,不是按修复难度。安全/诚实/合规(能直接打崩信任、监管可主动介入)排最前;架构债(尽调压估值但难速改)排后。
> 执行约定照旧:每版 tsc 0 + 单测 + live 验收(涉引擎必真跑)+ VERSIONS.md + push;每批末对抗评审;门面同步 GitHub/ModelScope。

---

## Batch A — 安全止血(v12.218–220)· 最高优先,几天内堵完前所有公关弹药有效

### v12.218 · 鉴权总修(致命洞群,一次拔除)
**动机**:🔴-2 / 🟠-10 已亲验确诊——枚举 projectId 读任意人剧本、多个 GET 端点无 token 回落「DB 第一个用户」,匿名即得他人项目/角色/用量。
**任务**:
- 新建 `lib/auth-guard.ts`:`requireOwner(request, projectId)` 纯逻辑(getUserFromRequest → getOwnedProject → 401/403),供所有项目作用域路由复用。
- 修 `app/api/projects/[id]/route.ts:11-20`:删「先不带 user_id 查」的 IDOR 路径,GET 直接走属主校验;PATCH 分支补 auth。
- 删除 5 处「回落第一个用户」:`app/api/projects/route.ts:10-13`、`app/api/characters/route.ts:12-15,43-44`、`app/api/usage/route.ts:10-13`、`app/api/usage/budget/route.ts:20`、`app/api/usage/summary/route.ts:29` → 无 token 一律 401。
- 修 `app/api/assets/route.ts` GET 分支(第11-50):加 `requireOwner`,`?projectId=` 必须属主。
- `app/api/health/providers/route.ts:80` GET 加登录校验(暴露 provider 拓扑/余额,不该匿名)。
- `app/api/projects/[id]/cost/route.ts`:成本数据含商业敏感,GET 从「免鉴权」改属主校验(与 decision-log 对齐,统一哲学)。
**验收**:①无 token curl 上述端点全部 401/403(live);②带他人 token curl 别人 projectId 得 403;③自己的 token 正常 200;④加回归测试锁每个端点的 401/403 路径(真行为断言,非 grep 源码)。
**风险**:demo/单用户模式会受影响——保留 `SEED_DEMO_USER` 但 demo 用户须真登录(已有 mint 流程),不再靠「第一个用户」裸奔。

### v12.219 · 密钥与配置硬化
**动机**:🔴-2 尾链 + 🟠-12——JWT_SECRET 默认值在模板、PLAN_GATE_DISABLED 可穿透付费墙。
**任务**:
- `lib/jwt.ts`(或签发处)启动自检:生产环境若 `JWT_SECRET` 缺失或等于 `.env.example` 的 `change_me...` 默认值 → 拒启动 + 明确报错。
- `lib/plan-gate.ts:50-51`:`PLAN_GATE_DISABLED` 在 `NODE_ENV==='production'` 强制忽略(仅 dev 生效),日志警告。
- `.env.example`:危险默认值加显著注释(JWT_SECRET/PLAN_GATE_DISABLED/DEMO），并核查 `git log --all` 确认无残留 `.env.local.bak-*` 明文密钥(有则 filter-repo 清理,复用 LFS 迁移经验)。
- CRON 已安全(生产 503),仅在 VERSIONS 澄清(敌对方夸大了此条)。
**验收**:①生产 env 用默认 JWT_SECRET 启动 → 进程拒起(live 模拟);②`NODE_ENV=production PLAN_GATE_DISABLED=1` 下 checkPlan 仍 gate（单测）；③git 历史扫描无明文 key。

### v12.220 · 诚实性止血(文案与门面,改几行的最低成本)
**动机**:🔴-1 / 🔴-3 / 🟠-15 / 🟠-19——承诺跑在能力前面是最大公关弹药,且大多只需改文案。
**任务**:
- `lib/i18n.ts:1051`(六语):撤下「Pro 商业许可可用于广告/品牌/电影发行」→ 改为「素材版权归属各生成引擎,商用请自查各引擎条款；青枫仅提供编排工具」。
- 定价页 + `alertPayment`:明确「支付尚未接入,当前为免费/自托管」，不留「即将上线」的空承诺。
- README 竞品表逐条校正:口型行 ja/ko/ru 标 ⚠️（仅 zh/en）、i18n 行去掉「no hardcoded strings」改「5 语核心 UI,组件级清偿中」、「Lipsync that actually works」加「zh/en，需公网视频+≥2s」限定。
- 测试数三处统一(README 徽章/VERSIONS/CONTRIBUTING 对齐真实全量数)。
**验收**:①README 无未兑现的 ✅（人工核对竞品表每格 vs 代码）；②i18n 商业承诺已撤（grep 确认）；③测试数三处一致。
**注**:这版不写功能,是「把已经张着的嘴闭上」——但杀伤面最大,故排安全之后立即做。

---

## Batch B — 合规底线(v12.221–222)· 监管可主动介入,不是竞品才能打

### v12.221 · 声音克隆授权门
**动机**:🔴-8 已亲验——克隆端点零授权/零核验,触《深度合成管理规定》第14条 + GDPR 第9条。
**任务**:
- `app/api/voice-clone/route.ts`:上传前必须 body 带 `consent:{authorized:true, purpose, ownerDeclaration}`，缺失 → 422 拒绝。
- voice-shelf 前端克隆入口:加授权声明 checkbox（「我确认已获被克隆人授权,仅用于合法用途」）+ 用途下拉,未勾选禁提交。
- 记录同意日志（consent_log 表,dual-driver）：who/when/purpose/ip，供合规追溯。
**验收**:①无 consent 的克隆请求 422（live）；②前端未勾选授权按钮禁用；③consent_log 落库（查表）。

### v12.222 · AI 内容强制标识
**动机**:🟠-16——抖音直发无 aigc_info、发布无强制 AI 声明,涉《规定》第17条。
**任务**:
- `lib/douyin.ts:62-77`:POST 注入 `aigc_info`（AI 生成标识）字段。
- `lib/drama-package.ts` + 发布流程:AI 声明从「文字提示」升级为**强制勾选**才能导出/发布。
- 成片可选水印:`services/video-composer.ts` 加 env 门控的「AI 生成」角标（drawtext，默认关,出海/合规场景开）。
**验收**:①抖音发布 body 含 aigc_info（日志）；②未勾 AI 声明无法进入发布（前端）；③水印开关 live 截帧验证。

---

## Batch C — 商业化真实性(v12.223–224)· 尽调算账压估值项

### v12.223 · 用量护栏真实化
**动机**:🔴-6——Pro ¥298/月无用量上限,单个 4K 重度用户月成本可超订阅价数倍。
**任务**:
- `lib/pricing.ts` + `lib/plan-gate.ts`:各订阅档加**月度生成配额/算力点**上限,超额 → 降级到经济引擎或提示充值。
- `lib/budget-estimate.ts`:校准「低估 5-10 倍」的估算（真实引擎单价对齐 v12.215 实测：4K ¥6/5s 等），生成前展示预估成本。
- 用量面板（usage 页)展示「本月已用/配额」环形进度。
**验收**:①超配额用户触发降级/拦截（单测 + live）；②成本预估与真实账单误差 <20%（对 kling-full 等已有项目回算）；③配额环形 live 显示。

### v12.224 · 成本透明面板
**动机**:🔴-6 尾——投资人要真实 COGS。
**任务**:成本下钻（v12.190 已有）扩展为「单片 COGS 报告」:逐引擎单价 × 用量 → 毛利视角；创作前「本片预估成本 ¥X」提示。
**验收**:live 对一条已完成片子出 COGS 报告,数字与 cost_log 一致。

---

## Batch D — 架构债 / 生产就绪(v12.225–228)· 难但尽调必问

### v12.225 · 神类拆分第一刀
**动机**:🔴-5——hybrid-orchestrator.ts 5471 行、113 处 `:any`、bus factor=1 观感。
**任务**:抽 `runWriter`/`runDirector`/`runEditor` 到独立模块（services/agents/*.ts），orchestrator 降为编排壳;消 `:any` 高危处（补类型)。**分多版渐进,本版先拆 Writer+Editor（最独立的两块），保证行为零变（全量回归 + 一条 live 端到端片子对比）。**
**验收**:①orchestrator 行数显著下降；②拆出模块独立可测；③live 端到端片子与拆分前逐镜一致。

### v12.226 · CI 加固(企业采购门槛)
**动机**:🟠-17——CI 仅 tsc+vitest,20 个 spec 从不跑,零安全扫描。
**任务**:CI 加 playwright e2e（核心创作路径 smoke）+ `npm audit`/dependabot + 依赖 license 检查（顺带处理 🟡-22 ffmpeg-static GPL-3 的 MIT 声明冲突,README 注明 Docker 分发含 GPL 组件）。
**验收**:CI 绿含 e2e + audit 步骤;license 报告无阻断性冲突。

### v12.227 · 多实例就绪(限流 + worker 锁)
**动机**:🟠(生产)——限流进程内（多实例撞库不受阻）、worker 单进程假设。
**任务**:限流/worker 抽象出「进程内 default + Redis 可选」双实现（env 切换,单机零改动),补分布式锁防任务多认领重复计费。
**验收**:单机行为零变（回归）;Redis 模式下模拟双实例不重复认领（集成测试）。

### v12.228 · 存储水平扩展
**动机**:🟠-18——S3 配了仍双写本地,ffmpeg 依赖 absPath,多 Pod serve-file 404。
**任务**:ffmpeg 消费方改「从 S3 拉临时文件 → 处理 → 回传」,去本地 absPath 硬依赖;serve-file 支持 S3 重定向。
**验收**:模拟无本地副本仅 S3 时成片全链通（live）。

---

## Batch E — 质量上限(v12.229–230)· 对标竞品的正面战场

### v12.229 · 音色库扩容 + 角色音色绑定
**动机**:🟠-14——6 档音色哈希轮转,8+ 角色撞音。
**任务**:音色档从 6 扩到 20+（MiniMax 音色 id 映射）+ 情感维度（speech-2.8 已接）+ 角色档案绑定专属音色（复用 v12.198 角色档案 + v12.208 克隆入口）。
**验收**:8 角色项目每角色独立音色(live 出片听辨)。

### v12.230 · 一致性 embedding 升级
**动机**:🟠(质量)——cameo 一致性靠 LLM Vision 打分,无 embedding 余弦比对,对标即梦「主体库」有差距。
**任务**:cameo-retry 从 LLM 打分升级视觉 embedding 余弦相似度硬判（BYO embedding endpoint,无 key 回落 LLM）。
**验收**:同角色跨镜 embedding 距离 live 验证,漂移镜识别率提升。

---

## Batch F — 收官(v12.231)
- 逐条复检 27 条软肋「堵了多少」，出「加固前 vs 后」对照表。
- README 竞品表 + 门面同步（GitHub + ModelScope intro）。
- 对抗评审复跑（同 7 路），确认致命项清零。

---

## 优先级速查
| 批次 | 版本 | 主题 | 为何这个顺序 |
|---|---|---|---|
| A | 218-220 | 安全止血 + 诚实止血 | 确诊真洞 + 改文案的最低成本,不堵一直有效 |
| B | 221-222 | 合规底线 | 监管可主动介入,不等竞品 |
| C | 223-224 | 商业化真实性 | 尽调算账压估值 |
| D | 225-228 | 架构债/生产就绪 | 难但尽调必问,渐进拆 |
| E | 229-230 | 质量上限 | 正面对标竞品 |
| F | 231 | 收官复检 | 验证致命项清零 |

**核实校正记录**(敌对报告的水分,已剔除):model-scan 端点实有鉴权;pull-sheet GET 实有属主校验;CRON 生产有 503 保护(仅本地放行);音色实为 6 档非 4。真确诊的核心洞:projects[id] IDOR、assets/projects/characters/usage×5 回落第一用户、health/providers 无鉴权、cost 免鉴权、JWT 默认密钥、PLAN_GATE 穿透、声音克隆无授权、抖音无 AI 标、限流进程内、神类、S3、CI。
