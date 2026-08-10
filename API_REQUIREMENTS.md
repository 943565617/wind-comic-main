# Wind Comic（风漫AI）Go 后端 API 接口需求规范文档

> **文件版本**：v1.0.0  
> **生成时间**：2026-08-08  
> **适用对象**：Go 后端开发团队 / 架构师  
> **前端框架**：Next.js (App Router) + React 19 + Tailwind CSS + Zustand / SWR  

---

## 1. 概述与架构设计

### 1.1 项目背景
`Wind Comic`（风漫）是一个基于 AI 多 Agent 协作的高性能 AI 漫剧/短剧全流水线生成平台。系统实现从**“一句灵感”到“完整影视/漫剧视频”**的全自动化生产（剧本生成 -> 分镜导演 -> 角色锁脸 -> 图像生成 -> 动作视频 -> TTS配音/口型对齐 -> 音轨合成 -> 导出与分发）。

为了提升底层处理性能、并发能力以及异步 AI 任务的调度效率，需要将原本 Next.js App Router 内部的 API 路由逐步迁移/对接至专用的 **Go 语言微服务/单体高性能后端**。

### 1.2 架构要求与技术选型建议
- **Go 框架**：推荐使用 **Gin** 或 **Fiber** 框架构建 RESTful API。
- **数据库/ORM**：推荐 **GORM** 或 **Ent**，底层数据库采用 **PostgreSQL**（开发环境可选 SQLite 兼容）。
- **异步队列**：AI 生成（如视频渲染、AI绘图、口型合成）属于长耗时任务，需使用基于 Redis 的 **Asynq** 或 **Machinery** 异步任务队列。
- **实时通信**：使用 **Gorilla WebSocket** 或 **Go-SSE** 实现工作流进度推送、实时多人协同与流式脚本生成。
- **缓存层**：使用 Redis 缓存热门模板、用户 Token 与实时配额数据。

---

## 2. 通用接口协议规范

### 2.1 HTTP 请求头 (Header)
```http
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
X-Request-ID: <UUID>  # 用于全链路 Trace 追踪
```

### 2.2 统一响应结构 (Response Format)

所有非流式 API 统一使用以下 JSON 结构返回：

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "timestamp": 1770545156,
  "trace_id": "req-9a8b7c6d"
}
```

**错误响应示例**：
```json
{
  "code": 40101,
  "message": "Token已过期或无效",
  "data": null,
  "timestamp": 1770545156,
  "trace_id": "req-9a8b7c6d"
}
```

### 2.3 状态码定义 (Status Codes)
- `200`: 请求成功
- `400`: 参数校验错误 / 业务非法
- `401`: 未登录或 Token 无效
- `403`: 无权限访问
- `404`: 资源不存在
- `429`: 请求触发频率限制 (Rate Limit) / 配额超限
- `500`: 后端内部错误

---

## 3. Go 结构体模型定义 (GORM / Data Models)

Go 后端需要实现以下核心数据实体（基于 `db/schema.pg.sql` 映射）：

```go
package models

import (
	"time"
	"gorm.io/gorm"
)

// User 用户实体
type User struct {
	ID                 string    `gorm:"primaryKey;type:varchar(64)" json:"id"` // 用户唯一ID
	Email              string    `gorm:"uniqueIndex;not null" json:"email"`     // 邮箱
	PasswordHash       string    `gorm:"not null" json:"-"`                     // 密码哈希（不输出到前端）
	Name               string    `gorm:"not null" json:"name"`                  // 用户昵称
	Role               string    `gorm:"not null;default:'user'" json:"role"`   // 角色: admin / user
	AvatarURL          string    `json:"avatar_url"`                            // 头像地址
	Locale             string    `gorm:"default:'zh'" json:"locale"`            // 语言首选项
	SubscriptionTier   string    `gorm:"default:'free'" json:"subscription_tier"`// 订阅等级
	BudgetCapCNY       float64   `json:"budget_cap_cny"`                        // 预算上限(元)
	CreatedAt          time.Time `json:"created_at"`                            // 创建时间
}

// Project 漫剧项目实体
type Project struct {
	ID                   string    `gorm:"primaryKey;type:varchar(64)" json:"id"` // 项目ID
	UserID               string    `gorm:"index;not null" json:"user_id"`         // 所属用户ID
	Title                string    `gorm:"not null" json:"title"`                 // 项目标题
	Description          string    `json:"description"`                           // 项目描述
	CoverURLs            string    `gorm:"type:text" json:"cover_urls"`           // 封面图数组 (JSON)
	Status               string    `gorm:"not null" json:"status"`                // 状态: draft/processing/completed
	ScriptData           string    `gorm:"type:text" json:"script_data"`          // 剧本结构体 (JSON)
	DirectorNotes        string    `gorm:"type:text" json:"director_notes"`       // 导演批注 (JSON)
	PipelineState        string    `gorm:"type:text" json:"pipeline_state"`       // 流水线状态 (JSON)
	Mode                 string    `gorm:"default:'episodic'" json:"mode"`        // 模式: episodic/single
	ExecutionMode        string    `gorm:"default:'dialogue'" json:"execution_mode"`// 执行模式: dialogue/narrative
	StyleID              string    `json:"style_id"`                              // 默认画风ID
	LockedCharacters     string    `gorm:"type:text" json:"locked_characters"`    // 锁脸角色定义 (JSON)
	CreatedAt            time.Time `json:"created_at"`                            // 创建时间
	UpdatedAt            time.Time `json:"updated_at"`                            // 更新时间
}

// ProjectAsset 镜头/场景/音轨等项目资产实体
type ProjectAsset struct {
	ID            string    `gorm:"primaryKey;type:varchar(64)" json:"id"` // 资产ID
	ProjectID     string    `gorm:"index;not null" json:"project_id"`      // 项目ID
	Type          string    `gorm:"not null" json:"type"`                  // 类型: shot/character/scene/audio
	Name          string    `gorm:"not null" json:"name"`                  // 资产名称
	Data          string    `gorm:"type:text" json:"data"`                 // 资产元数据 (JSON)
	MediaURLs     string    `gorm:"type:text" json:"media_urls"`           // 媒体链接数组 (JSON)
	ShotNumber    int       `json:"shot_number"`                           // 镜头编号
	Version       int       `gorm:"default:1" json:"version"`              // 资产版本号
	Confirmed     bool      `gorm:"default:false" json:"confirmed"`        // 是否已确认
	PersistentURL string    `json:"persistent_url"`                        // 持久化对象存储URL
	CreatedAt     time.Time `json:"created_at"`                            // 创建时间
	UpdatedAt     time.Time `json:"updated_at"`                            // 更新时间
}
```

---

## 4. 后端 API 接口需求清单

### 4.1 模块一：用户认证与账号管理 (Auth & User)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register` | 用户注册（支持邮箱+密码，验证邀请码） | 写入 `users` 表 |
| `POST` | `/api/v1/auth/login` | 用户登录（返回 JWT Token） | 校验 `password_hash` |
| `POST` | `/api/v1/auth/logout` | 退出登录（废弃 Token/Redis Blacklist） | |
| `GET` | `/api/v1/users/me` | 获取当前登录用户信息 | 包含订阅等级与偏好 |
| `PUT` | `/api/v1/users/me` | 修改个人资料 (昵称、头像、语言) | |
| `GET` | `/api/v1/users/lookup` | 模糊搜索用户（通过邮箱/昵称） | 用于添加项目协同人员 |
| `POST` | `/api/v1/waitlist` | 提交 Waitlist 预约内测申请 | 写入 `waitlist` 表 |

---

### 4.2 模块二：漫剧项目与协作管理 (Projects & Collaboration)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/projects` | 获取当前用户的项目列表 (支持分页与状态过滤) | 支持查询带关联字段 |
| `POST` | `/api/v1/projects` | 创建新漫剧项目 | 初始化项目基础配置 |
| `GET` | `/api/v1/projects/:id` | 获取项目完整详情 (含剧本、镜头资产) | 核心渲染页面数据 |
| `PUT` | `/api/v1/projects/:id` | 更新项目元信息 / 剧本 / 导演批注 | |
| `DELETE` | `/api/v1/projects/:id` | 删除指定项目 | 级联清理相关资产记录 |
| `GET` | `/api/v1/projects/:id/assets` | 获取项目下的所有资产（镜头/图片/音频） | |
| `POST` | `/api/v1/projects/:id/assets` | 创建/批量更新项目资产 | |
| `GET` | `/api/v1/projects/:id/collaborators` | 获取项目协同成员列表 | |
| `POST` | `/api/v1/projects/:id/collaborators` | 添加协同成员 / 更改权限 (editor/viewer) | |
| `DELETE` | `/api/v1/projects/:id/collaborators/:userId` | 移除协同成员 | |
| `POST` | `/api/v1/projects/:id/share` | 创建项目分享 Link / Token | 写入 `project_share_tokens` |

---

### 4.3 模块三：AI 剧本生成与多 Agent 导演管线 (Script & Agent Pipeline)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/story-intake/analyze` | AI分析长文/灵感，生成分幕大纲 | 调用 LLM（OpenAI/Claude） |
| `POST` | `/api/v1/story-intake/split` | 将大纲拆解为逐镜头剧本与台词 | 返回结构化镜头列表 |
| `POST` | `/api/v1/polish-script` | 润色/重写指定镜头脚本 | |
| `POST` | `/api/v1/create` | 触发全自动化生成流水线 (脚本->绘图->视频) | 异步 Agent 管线 |
| `GET` | `/api/v1/create-stream` | SSE 流式获取流水线生成进度与日志 | **Server-Sent Events** |
| `POST` | `/api/v1/pipeline-jobs` | 查询或重试指定阶段的任务 (Rerun Pipeline) | 写入 `pipeline_reruns` |

---

### 4.4 模块四：AI 画面、视频生成与视觉一致性 (AI Media & Consistent Characters)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/generations` | 触发文生图/图生图任务 (Midjourney/Minimax/Gemini) | 返回异步 Task ID |
| `GET` | `/api/v1/generations/:id` | 轮询/获取生成的图像结果 | |
| `POST` | `/api/v1/u2v` | 触发图生视频 (U2V) / 动作视频合成 (Kling/Minimax/Vidu) | 长耗时任务 |
| `GET` | `/api/v1/u2v/stream` | SSE 推送视频生成实时百分比与状态 | **Server-Sent Events** |
| `POST` | `/api/v1/preview-shot` | 单镜头快速生成预览 | 用于前端极速试看 |
| `POST` | `/api/v1/regenerate-shot` | 结合重新抽卡/修改Prompt重新生成特定镜头 | |
| `POST` | `/api/v1/tools/remove-bg` | 智能抠图 / 去除角色背景 | 工具接口 |
| `GET` | `/api/v1/characters` | 获取全局/项目角色库 | 包含参考脸图与 Visual Tags |
| `POST` | `/api/v1/characters` | 添加/更新角色人设与锁脸基准图 | 用于保脸一致性 (Locked Character) |

---

### 4.5 模块五：TTS 配音、声音克隆与口型同步 (Voice & Audio Engineering)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/narration` | 批量生成剧本台词 TTS 音频文件 | 集成 Minimax TTS 等引擎 |
| `POST` | `/api/v1/voice-clone` | 上传声音样本进行声音复刻/克隆 | |
| `POST` | `/api/v1/projects/:id/lipsync` | 镜头视频与 TTS 音频对齐生成对口型视频 | Lip-sync 智能对齐 |
| `GET` | `/api/v1/projects/:id/lipsync/render` | 获取对口型视频渲染进度与输出 URL | |

---

### 4.6 模块六：模板市场与工作流 Studio (Templates & Workflow Engine)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/templates` | 获取成片/画风模板市场列表 (支持分类与热度排序) | `film_templates` 表 |
| `GET` | `/api/v1/templates/:id` | 获取模板详情与预设 Prompt 节点 | |
| `POST` | `/api/v1/templates/:id/use` | 一键基于模板创建新漫剧项目 | |
| `POST` | `/api/v1/templates/:id/favorite` | 收藏 / 取消收藏模板 | `template_favorites` 表 |
| `POST` | `/api/v1/templates/:id/rate` | 对模板打分评级 | `template_ratings` 表 |
| `GET` | `/api/v1/workflows` | 获取用户自定义的工作流 (Node Graph JSON) | `agent_workflows` 表 |
| `POST` | `/api/v1/workflows` | 保存/更新工作流图设计 | |
| `POST` | `/api/v1/workflows/:id/execute` | 运行节点式工作流引擎 | 支持分节点数据流传递 |

---

### 4.7 模块七：多人评论、通知与 WebSocket 实时协同 (Real-time & Comments)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/projects/:id/comments` | 获取项目/分镜树上的评论列表 (支持 @提醒) | `comments` 表 |
| `POST` | `/api/v1/projects/:id/comments` | 发表评论 (支持带附件图片/音轨标记) | 触发被 @ 人的 Notification |
| `DELETE` | `/api/v1/comments/:id` | 删除指定评论 | |
| `GET` | `/api/v1/notifications` | 获取当前用户的未读站内通知 | `notifications` 表 |
| `POST` | `/api/v1/notifications/read` | 批量标记通知已读 | |
| `WS` | `/ws/v1/projects/:id/sync` | **WebSocket** 实时多人协同编辑与云端指针同步 | 支持 Yjs / CRDT 协议数据传输 |

---

### 4.8 模块八：订阅计费、用量审计与监控 (Billing, Usage & Telemetry)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/stripe/checkout` | 创建 Stripe 订阅支付 Session | 会员订阅购买 |
| `POST` | `/api/v1/stripe/webhook` | 接收 Stripe 支付成功/退订 Webhook 回调 | 异步更新订阅状态 |
| `GET` | `/api/v1/usage/summary` | 获取用户当前 Credits 额度与消费明细 | 算力消耗统计 |
| `GET` | `/api/v1/usage/budget` | 查询/更新用户的单月预算硬顶 (Budget Cap) | 防止算力超支 |
| `POST` | `/api/v1/telemetry/ui-event` | 前端埋点数据采集 | 日志收集 |

---

### 4.9 模块九：短剧打包、分发与定时发布 (Distribution & Publishing)

| HTTP 方法 | 接口路径 | 接口描述 | 备注 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/projects/:id/publish-preflight` | 短剧导出前预检 (检测音频跳字、缺镜、分辨率 mismatch) | 质量控制 |
| `POST` | `/api/v1/projects/:id/publish-package` | 触发短剧打包渲染 (导出完整 MP4 + 字幕文件) | 依赖 FFmpeg 服务 |
| `POST` | `/api/v1/projects/:id/publish` | 发布短剧到多平台 (抖音/快手/YouTube/Bilibili) | `publish_records` 表 |
| `POST` | `/api/v1/projects/:id/schedule-publish` | 设置定时自动发布队列 | `scheduled_publishes` 表 |

---

## 5. 核心业务处理逻辑示例 (Go Code Specification)

为保障 Go 后端编写代码规范、可维护且符合最佳实践，提供以下控制器与服务实现参考：

### 5.1 项目控制器实现 (Project Handler)

```go
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"wind-comic/models"
	"wind-comic/services"
)

// ProjectHandler 项目相关控制器结构体
type ProjectHandler struct {
	projectService *services.ProjectService // 注入项目服务
}

// NewProjectHandler 初始化项目控制器
func NewProjectHandler(ps *services.ProjectService) *ProjectHandler {
	return &ProjectHandler{projectService: ps}
}

// GetProjectByID 获取指定项目的详细信息 handler
// @Summary 获取项目详情
// @Tags Projects
// @Param id path string true "项目ID"
// @Success 200 {object} models.Project
// @Router /api/v1/projects/{id} [get]
func (h *ProjectHandler) GetProjectByID(c *gin.Context) {
	projectID := c.Param("id")
	userID := c.GetString("user_id") // 从 JWT 中获取当前登录用户

	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    40001,
			"message": "项目ID不能为空",
		})
		return
	}

	// 调用 service 校验权限并获取数据
	project, err := h.projectService.GetProjectWithDetails(c.Request.Context(), projectID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"code":    50001,
			"message": "获取项目详情失败: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code":      200,
		"message":   "success",
		"data":      project,
		"timestamp": c.GetInt64("request_time"),
	})
}
```

### 5.2 长耗时任务推流 Handler (SSE Stream for AI Generation)

```go
package handlers

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// StreamPipelineProgress 流式推送 AI 漫剧生成进度 (SSE 规范)
func (h *ProjectHandler) StreamPipelineProgress(c *gin.Context) {
	projectID := c.Query("project_id")

	// 设置 SSE 响应头
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("Access-Control-Allow-Origin", "*")

	// 模拟流式推送逻辑
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Streaming unsupported"})
		return
	}

	c.Stream(func(w io.Writer) bool {
		// 监听 Redis PubSub 或 channel 的进度事件
		for i := 1; i <= 100; i += 10 {
			eventData := fmt.Sprintf(`{"projectId":"%s","progress":%d,"stage":"generating_storyboards"}`, projectID, i)
			fmt.Fprintf(w, "data: %s\n\n", eventData)
			flusher.Flush()
			time.Sleep(500 * time.Millisecond)

			if i == 100 {
				fmt.Fprintf(w, "event: complete\ndata: {\"status\":\"finished\"}\n\n")
				flusher.Flush()
				return false // 结束推流
			}
		}
		return false
	})
}
```

---

## 6. 文件上传与存储服务 (Media Storage)

Go 后端需要对接对象存储（S3 / 阿里云 OSS / 腾讯云 COS），提供文件直传 API：

1. **预签名地址获取**：`POST /api/v1/upload/presigned-url`
   - 前端上传大文件（如镜头视频、声音样本）时，先请求 Go 后端获取 S3 Presigned Upload URL，直接从前端传对象存储，避免占用 Go 服务端带宽。
2. **静态文件服务与 CDN 回源**：
   - 生产环境中，生成的画面/音视频一律归档到 S3 存储，并绑定 CDN 加速域名返回给前端。

---

## 7. 调试与部署规范

1. **Docker 与 Docker Compose 支持**：
   - 在项目根目录提供 `Dockerfile.backend` 与包含 PostgreSQL、Redis、Asynq-Mon 的 `docker-compose.go.yml`。
2. **日志与链路追踪**：
   - 使用 **Uber Zap** 结合 **Loki / Jaeger** 输出 JSON 格式结构化日志，每条日志附带 `trace_id` 与 `user_id`。
3. **API 文档化**：
   - 使用 `swag`（`github.com/swaggo/swag`）根据 Go 注释自动生成 Swagger / OpenAPI 3.0 规范接口文档（暴露于 `/swagger/index.html`）。

---

> **文档总结**：Go 后端应优先实现 **用户系统**、**项目与资产 CRUD** 以及 **SSE 流式生成进度**。涉及多 Agent 调用的 AI 接口可以先封装中间件直通第三方 SDK/Proxy，后续根据算力负载扩展微服务集群。
