# AniList 双元数据扩展

依据上传的《Mediary Scout o0521 二次开发规划 v2.0》实施。本文记录实际实现与验收边界，不把外部服务验证视为已经通过。

## 源码检查与仓库状态

2026-10-28 检查结果：

- Fork：`QFgood/mediary-scout-o0521`，起点 `c528c30`，工作区最初干净、没有开放 PR。
- 上游：`fancydirty/mediary-scout`，检查时 `main` 为 `0e397a6`。Fork 落后 14 个提交、领先 1 个 Docker CI 提交。未发现现成的 AniList 实现或相关 PR；需求 issue #328 仍开放。
- 开发分支：`feature/anilist-metadata-verified-tasks`。保留 Fork 当前基线，避免把无关的上游更新混入功能变更。
- 推送前发现远端已有 `feature/anilist-metadata`（`1b72a4c`），包含此前的 AniList 浏览实现及开发规划，获取入口仍全部禁止。本次采用独立分支向 `main` 提供带整季任务适配的实现，不覆盖该远端分支；两版不能直接相互叠加，审阅时应选择实现或另行整合其独立详情页等差异。
- `packages/workflow/src/search-view.ts` 的 `MediaSearchCandidate` 强制要求 `tmdbId`；原搜索卡片、`showHref`、任务解析、资源命名、Worker 和巡检均以 TMDB 为锚点。
- `apps/web/lib/workflow-runtime.ts` 通过 `tmdb_tv_<id>_s<season>` 进入队列，`prepareTrackingTarget` 获取 TMDB 详情和季度；数据库将作品和季度保存为 JSON。
- 独立 AniList 搜索模型避免向原 `MediaSearchCandidate` 塞入错误 ID。任务适配使用真实 TMDB 季度锚点，原选择保存在季度的 `metadataOrigin` 中，无数据库迁移。
- 实际 Worker 测试发现 V2 结果桥会重建季度对象，因此给结果桥与 runner 增加可选来源字段的透传，保持初始化、巡检、换源和恢复时的来源信息；Agent 的启动和执行模式保持原有实现。

## 已实现

- 原搜索页增加 TMDB / AniList 标签；关键词输入、海报卡片、获取入口和工作区路径继续沿用原交互。
- AniList GraphQL 搜索与精确作品详情，通过普通 API 请求完成；只显示非成人的日本动画，保留日文、英文、罗马字和别名。
- 来源与 ID 分开：`tmdb:<id>` 与 `anilist:<id>`。海报点击携带 `source=anilist&anilistId=<id>`，避免同名续作被重新搜索为另一条作品。
- 标题、年份、海报和集数确定性转换；未知年份/集数保持未知，不把春夏秋冬推断成第几季。
- 搜索来源与精确条目按网盘保存在浏览器会话中；重新输入关键词会清除旧的精确条目。
- 请求 8 秒超时；GraphQL 错误、HTTP 错误和损坏的响应会隔离为 AniList 错误界面，允许切回 TMDB。429 根据 `Retry-After` 进入最长 5 分钟冷却。
- 有界进程缓存：搜索 15 分钟、详情 1 小时、榜单 12 小时；同键请求合并，结果克隆隔离，最多 256 键。仅榜单允许额外 7 天历史缓存；重启后缓存丢失，与桌面版现有缓存取舍一致。
- 热门电影/剧集继续使用 TMDB；动漫提供当季、近期热门、即将播出三类 AniList 榜单，失败先读历史缓存，再回退原 TMDB 动漫榜单，并标明实际来源。
- 获取入口重新读取服务端元数据、核验管理员配置，不接受浏览器提交的集数、TMDB ID 或映射。通过核验的目标复用现有队列、Worker、Agent、转存和追更机制。

## 整季映射配置

默认 **不包含任何真实作品的映射**，不会自动关联两个平台。AniList 的条目拆分可能和 TMDB 不同，标题相近或集数相等不能证明对应。

管理员应先人工比对可信资料，确认 AniList 的整个条目与 TMDB 的整个季度一一对应，再设置服务端环境变量 `MEDIA_TRACK_ANILIST_MAPPINGS`（JSON 数组）。示例 ID 全是占位值，不能直接作为真实映射：

```dotenv
MEDIA_TRACK_SEARCH_PROVIDER=tmdb
MEDIA_TRACK_ANILIST_MAPPINGS='[{"anilistId":999,"tmdbId":111,"seasonNumber":3,"episodeCount":12,"evidenceUrl":"https://example.com/reviewed-episode-list"}]'
```

Docker Compose 已通过 `env_file` 读取根目录 `.env`，无需改变部署架构。更新配置后重建容器进程使环境变量生效（`docker compose up -d --force-recreate web`）；不需要改镜像构建参数。桌面版使用启动服务端进程时的环境配置。

所有字段均必填；`evidenceUrl` 是供人工复核的 HTTPS 资料链接，程序不会访问该链接。每个 AniList ID 和每个 TMDB 季度只能出现一次。未知字段、重复目标、无效 ID 或损坏 JSON 均拒绝。

提交前同时要求：

1. AniList 类型为 TV / TV_SHORT / ONA / OVA，且集数已知并等于配置值。
2. TMDB 返回的目标为日本动画，作品 ID、季度 ID、季度编号与配置完全一致。
3. TMDB 整季集数也等于配置值。

页面会显示对应的 TMDB 季度与集数；点击获取后再次校验并提交。队列仍使用真实 TMDB ID，去重、资源目录和巡检沿用 TMDB 的季度语义；原 AniList ID、标题、别名、集数和核验资料保存到 `metadataOrigin`。

**当前兼容边界：** 不支持 AniList 电影获取、跨季聚合、部分集数截取、连续集数偏移或无法验证的独立续作。此类目标可浏览和搜索，获取按钮禁用并显示原因。《药屋少女的呢喃》第三季如果没有对应的可信 TMDB 整季映射，也会被阻止，绝不转成第一季全部 60 集。完整的 AniList 原生独立任务/连续集数模型仍需后续开发和真实数据验证，不能靠填一个映射绕过。

## 验收

自动测试覆盖 API 请求与超时、GraphQL/HTTP 错误、429 冷却、缓存并发/过期/容量/历史回退、独立 ID、工作区与精确条目导航、动漫榜单来源与故障隔离，以及错季/集数变化/无映射拦截。使用模拟模型与存储执行原 Worker，检查内存及 SQLite 中的原始来源、网盘隔离和 S03 集数范围。

实站探测：当前云环境访问 `graphql.anilist.co` 返回 Cloudflare HTTP 403，不能据此确认具体作品收录或真实 API 响应。真实 Agent 模型、网盘凭据和已核验的真实作品映射未用于测试；真实资源检索、夸克转存及结果验证仍待可用部署环境验收。单元与模拟执行通过不代表真实转存已成功。

本次本地验证结果：

| 验证 | 结果 |
|---|---|
| `npm run lint`、工作流/Web/桌面端/两个 Worker 的 TypeScript 检查 | 通过 |
| 非 PostgreSQL 专项回归 `vitest run --exclude '**/*.pg.test.ts'` | 357 文件通过、2 文件跳过；4903 测试通过、2 跳过 |
| 临时 PostgreSQL 16 上顺序执行全部 `.pg.test.ts`、仓库契约与 schema 测试 | 9 文件、139 测试通过 |
| `npm run build:web` | 通过，包含无数据库连接时的静态页面构建 |
| Docker 多阶段构建、启动迁移与 `/api/health` | 通过；仅测试用临时 Dockerfile 增加云环境 CA secret mount，仓库 Dockerfile 保持原样 |
| Chromium 桌面与移动端 | TMDB 回归、来源切换、关键词提交、来源/关键词记忆、AniList 失败隔离通过 |
| 模拟 AniList/TMDB API 的浏览器获取流程 | 显示第三季 → 点击获取 → 原队列/Worker 执行 → SQLite 保留 `anilistId=999` 与真实测试 TMDB 季度 `tmdb_tv_111_s3`；使用模拟模型/存储，以 `no_coverage` 正常结束，未进行真实转存 |
| 上游 `0e397a6` 临时检出 + 本功能补丁 | 干净应用；工作流构建、Web 类型检查及 56 项相关测试通过 |

规划书阶段对照：第一阶段源码检查、第二阶段检索、第四阶段榜单已实现；第三阶段完成安全适配与模拟队列验证，独立续作原生获取和真实执行待验证；第五阶段完成上述自动验证，生产部署与真实转存尚未执行。
