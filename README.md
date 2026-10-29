<p align="center">
  <img src="docs/images/hero.svg" alt="巡影 · Mediary Scout 多元数据版" width="600">
</p>

<h1 align="center">巡影 · Mediary Scout 多元数据版</h1>
<p align="center"><b>通过 Docker 自部署，为自己的网盘搜索、获取和追踪电影、剧集与动漫。</b></p>

<p align="center">
  <a href="https://github.com/QFgood/mediary-scout-o0521/actions/workflows/ci.yml"><img src="https://github.com/QFgood/mediary-scout-o0521/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-0BSD-blue" alt="0BSD license"></a>
  <img src="https://img.shields.io/badge/deploy-Docker-2496ED?logo=docker&logoColor=white" alt="Docker 部署">
</p>

<p align="center">
  <a href="#docker-部署">Docker 部署</a> ·
  <a href="https://github.com/QFgood/mediary-scout-o0521/pulls">开发进展</a> ·
  <a href="https://github.com/QFgood/mediary-scout-o0521/issues">问题反馈</a> ·
  <a href="https://afdian.com/a/o0521/plan">爱发电支持</a> ·
  <a href="README.en.md">English</a>
</p>

本项目基于 [Mediary Scout](https://github.com/fancydirty/mediary-scout) 二次开发，聚焦 **TMDB / AniList 双元数据、动漫获取、网盘媒体库恢复与按服务选择代理**。本 Fork 仅维护 Docker 自部署版本，适用于 NAS、软路由和服务器，使用浏览器访问。

**维护方针：独立维护，不再跟随上游同步合并。** 后续功能、修复与部署说明以本仓库为准；保留上游来源署名和开源许可证。

搜索想看的作品，发起获取或预定；Agent 搜索资源、选择候选、转存到你绑定的网盘并验证入库，后续通过巡检追踪已播缺集。资源能否获取取决于资源源、模型和网盘的实际可用性。

## 当前功能

| 功能 | 说明 |
| --- | --- |
| 双元数据搜索 | 可切换 TMDB 与 AniList；AniList 提供当季、热门和待播动漫榜单。 |
| AniList 原生任务 | 电视动画无需 TMDB 季度映射即可获取、查看详情、加入媒体库和自动追更；动画电影支持获取与未上映预定。 |
| 中文名称辅助搜索 | 中文输入在 AniList 无结果时，通过 TMDB 查询作品原名后再搜 AniList；日文、英文和罗马字直接搜索。简称能否命中取决于元数据收录情况。 |
| 网盘媒体库恢复 | 从当前绑定网盘的原 Movies / TV / Anime 目录恢复记录并复核入库集号，支持季度目录中的 `001.mkv` 等命名；确认缺少的已播集自动提交补集，无法确认的内容列入报告并暂缓补集。详见[恢复说明](docs/library-drive-sync.md)。 |
| 按服务选择 SOCKS5 | 可选择仅为 AniList、TMDB、PanSou、assrt.net、Jev 启用代理，并测试代理入口及目标连接；其他服务沿用原连接方式。 |
| 可配置资源与模型 | 配置 OpenAI 兼容模型、PanSou、可选 Prowlarr、字幕来源及 Jev 候选预筛，保留获取活动与通知。 |

## Docker 部署

主机需安装 Git、Docker Engine 和 Docker Compose v2；首次部署需要拉取依赖镜像并构建 Web 镜像。

```bash
git clone https://github.com/QFgood/mediary-scout-o0521.git
cd mediary-scout-o0521
GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --build
```

打开 `http://<主机IP>:3000`。Compose 会启动 Web（含后台 Worker）、PostgreSQL、PanSou 和更新辅助服务。

如需更换端口，在仓库根目录 `.env` 中设置 `WEB_PORT=3004`，再运行上述 Compose 命令，即可通过 `http://<主机IP>:3004` 访问。端口由你的部署配置决定。

### 首次配置

1. 在「设置 → 网盘」绑定自己的网盘；需要恢复媒体库时，连接原来保存资源的网盘及分类目录。
2. 在「设置 → 资源与服务」检查 AI 模型、TMDB、AniList 和 PanSou 配置。AniList 公共 API 默认不需要 Key，可设置兼容接口地址。
3. 网络访问受限时，在「SOCKS5 服务代理」填写容器可访问的代理地址，勾选需要代理的服务并测试。容器中的 `127.0.0.1` 指向容器自身，应按实际网络填写主机或局域网地址。
4. 搜索作品后点击「获取」；未上映电影可「预定」。已有网盘资源可在「媒体库」点击「同步网盘资源」。

未配置自有 AI 模型时，应用默认使用 Kilo Code 公共免费模型池。获取任务上下文（查询、留言、候选结果、文件名等）会发送给 Kilo 及其上游模型提供商；也可在设置中改为自己的 OpenAI 兼容服务。Docker 内置 PanSou，可在设置中更换实例。

### 更新与备份

更新前备份数据库；在仓库目录执行：

```bash
./scripts/pg-backup.sh ./backups
git pull --ff-only
GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --build
```

查看运行状态与日志：

```bash
docker compose ps
docker compose logs --tail=100 web
```

PostgreSQL 数据保存在 `pgdata` 卷中。更新时保留数据卷；`docker compose down -v` 会删除卷。网盘同步可以恢复部分媒体库事实，不能代替数据库备份，也不能恢复旧任务历史和用户设置。

## 支持的网盘

| 网盘 | 获取方式 |
| --- | --- |
| 夸克 | 分享链转存 |
| 115 | 分享链与磁力 |
| 123 网盘 | 分享链与磁力 |
| 光鸭云盘 | 分享链与磁力 |
| 天翼云盘 | 分享链转存 |

## 文档

- [AniList 功能、配置与边界](docs/anilist-development.md)
- [从网盘恢复媒体库](docs/library-drive-sync.md)
- [部署参考：网盘连接、镜像加速与备份](docs/deploy.md)（包含上游历史说明，当前 Fork 的部署范围以本页为准）
- [Agent API](docs/agent-api.md)
- [架构说明](docs/architecture.md)

## 支持项目

如果这个 Docker 多元数据版对你有帮助，欢迎通过 **[爱发电支持 o0521](https://afdian.com/a/o0521/plan)**。问题和功能建议请提交到[本仓库 Issues](https://github.com/QFgood/mediary-scout-o0521/issues)。

## 开源许可与致谢

沿用 [0BSD 许可证](LICENSE)，保留原项目版权与许可信息。感谢原项目 [Mediary Scout](https://github.com/fancydirty/mediary-scout) 及贡献者，以及 [PanSou](https://github.com/fish2018/pansou-web)、[Prowlarr](https://github.com/Prowlarr/Prowlarr)、[p115client](https://github.com/ChenyangGao/p115client)、[p123client](https://github.com/ChenyangGao/p123client)、[AList](https://github.com/AlistGo/alist)、[cloud189-auto-save](https://github.com/1307super/cloud189-auto-save) 和 [cloudpan189-api](https://github.com/tickstep/cloudpan189-api)。

元数据来自 [TMDB](https://www.themoviedb.org/) 与 [AniList](https://anilist.co/)。本项目为开源自部署软件，与各网盘、元数据服务及资源索引器无隶属或背书关系。
