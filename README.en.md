<p align="center">
  <img src="docs/images/hero.svg" alt="Mediary Scout — Multi-metadata Edition" width="600">
</p>

<h1 align="center">Mediary Scout · Multi-metadata Edition</h1>
<p align="center"><b>A Docker self-hosted media library for movies, shows and anime in your own cloud drives.</b></p>

<p align="center">
  <a href="https://github.com/QFgood/mediary-scout-o0521/actions/workflows/ci.yml"><img src="https://github.com/QFgood/mediary-scout-o0521/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-0BSD-blue" alt="0BSD license"></a>
  <img src="https://img.shields.io/badge/deploy-Docker-2496ED?logo=docker&logoColor=white" alt="Docker deployment">
</p>

<p align="center">
  <a href="#docker-deployment">Docker deployment</a> ·
  <a href="https://github.com/QFgood/mediary-scout-o0521/pulls">Development</a> ·
  <a href="https://github.com/QFgood/mediary-scout-o0521/issues">Issues</a> ·
  <a href="https://afdian.com/a/o0521/plan">Support on Afdian</a> ·
  <a href="README.md">中文</a>
</p>

This fork of [Mediary Scout](https://github.com/fancydirty/mediary-scout) focuses on **TMDB / AniList metadata, anime acquisition, cloud-drive library recovery and per-service proxy selection**. This fork maintains the Docker self-hosted edition only, for NAS devices, routers and servers, with a browser interface.

**Maintenance policy: independently maintained; upstream changes will no longer be synchronized or merged as a release policy.** Features, fixes and deployment instructions follow this repository. Upstream attribution and the open-source license are retained.

Search for a title and request acquisition or reserve an upcoming movie. The agent searches for resources, selects candidates, transfers them to your connected drive and verifies arrival. Scheduled patrols track missing aired episodes. Availability depends on the resource providers, model and drive services.

## Current features

| Feature | Behavior |
| --- | --- |
| Dual metadata search | Switch between TMDB and AniList; AniList offers seasonal, trending and upcoming anime feeds. |
| Native AniList tasks | Acquire, view and track TV anime without a TMDB season mapping. Anime movies support acquisition and advance reservations. |
| Chinese title assistance | If a Chinese query returns no AniList results, look up original titles through TMDB and search AniList again. Japanese, English and romanized names use direct search. Abbreviation coverage depends on the metadata catalogs. |
| Drive library recovery | Restore and reconcile records from the connected drive's original Movies / TV / Anime directories, including numeric names such as `001.mkv` in season directories. Queue confirmed missing aired episodes automatically; report uncertain files and defer acquisition for those cases. See the [recovery guide](docs/library-drive-sync.md). |
| Per-service SOCKS5 | Optionally proxy AniList, TMDB, PanSou, assrt.net and Jev, with entry and destination connection tests. Other services retain their existing connections. |
| Configurable providers | Configure an OpenAI-compatible model, PanSou, optional Prowlarr, subtitles and Jev candidate screening, with acquisition activity and notifications. |

## Docker deployment

Install Git, Docker Engine and Docker Compose v2 on the host. The first deployment pulls dependencies and builds the Web image.

```bash
git clone https://github.com/QFgood/mediary-scout-o0521.git
cd mediary-scout-o0521
GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --build
```

Open `http://<host-ip>:3000`. Compose starts Web with its background worker, PostgreSQL, PanSou and the updater helper.

To use another port, set `WEB_PORT=3004` in the repository's `.env` file and run the Compose command again. The browser address is then `http://<host-ip>:3004`.

### Initial setup

1. Connect your own drive in Settings → 网盘. For library recovery, connect the original drive and category directories.
2. Check the AI model, TMDB, AniList and PanSou settings under Settings → 资源与服务. The public AniList API needs no API key by default; a compatible endpoint can be configured.
3. If needed, enter a container-accessible SOCKS5 address, select the services and test the connection. `127.0.0.1` inside a container refers to that container; use the appropriate host or LAN address for your network.
4. Search and select 获取 to acquire a title, or 预定 to reserve an upcoming movie. Use 同步网盘资源 in the library to recover existing drive resources.

Without a custom AI configuration, the app uses Kilo Code's public free model pool. Acquisition context, including queries, messages, candidates and file names, is sent to Kilo and its upstream model providers. You can configure your own OpenAI-compatible service instead. Docker includes PanSou; its instance can be changed in Settings.

### Updates and backups

Back up the database before updating. From the repository directory:

```bash
./scripts/pg-backup.sh ./backups
git pull --ff-only
GIT_SHA="$(git rev-parse HEAD)" docker compose up -d --build
```

Inspect status and logs:

```bash
docker compose ps
docker compose logs --tail=100 web
```

PostgreSQL persists in the `pgdata` volume. Preserve volumes when updating; `docker compose down -v` deletes them. Drive synchronization can recover some library facts, but does not replace database backups or restore old task history and user settings.

## Supported drives

| Drive | Acquisition sources |
| --- | --- |
| Quark | Share links |
| 115 | Share links and magnets |
| 123 | Share links and magnets |
| GuangYaPan | Share links and magnets |
| Tianyi | Share links |

## Documentation

These detailed guides are in Chinese:

- [AniList features, configuration and limitations](docs/anilist-development.md)
- [Recover a library from drive files](docs/library-drive-sync.md)
- [Deployment reference: drive setup, image mirrors and backups](docs/deploy.md) (includes historical upstream instructions; this page defines the fork's supported deployment scope)
- [Agent API](docs/agent-api.md)
- [Architecture](docs/architecture.md)

## Support this project

If this Docker multi-metadata edition helps you, you can **[support o0521 on Afdian](https://afdian.com/a/o0521/plan)**. Please submit bugs and feature requests to [this repository's Issues](https://github.com/QFgood/mediary-scout-o0521/issues).

## License and credits

Released under the [0BSD license](LICENSE), retaining the upstream copyright and license. Thanks to [Mediary Scout](https://github.com/fancydirty/mediary-scout) and its contributors, [PanSou](https://github.com/fish2018/pansou-web), [Prowlarr](https://github.com/Prowlarr/Prowlarr), [p115client](https://github.com/ChenyangGao/p115client), [p123client](https://github.com/ChenyangGao/p123client), [AList](https://github.com/AlistGo/alist), [cloud189-auto-save](https://github.com/1307super/cloud189-auto-save) and [cloudpan189-api](https://github.com/tickstep/cloudpan189-api).

Metadata comes from [TMDB](https://www.themoviedb.org/) and [AniList](https://anilist.co/). This is open-source self-hosted software, with no affiliation or endorsement from the drive, metadata or indexer services.
