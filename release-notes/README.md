# 发布说明

本 Fork 的版本检查、发布说明及安装包来源统一为 [QFgood/mediary-scout-o0521](https://github.com/QFgood/mediary-scout-o0521)。设置页的「更新日志」链接打开本目录，版本号链接打开该仓库对应的 Release。如果尚未发布可识别的日期标签，页面提供[本项目提交记录](https://github.com/QFgood/mediary-scout-o0521/commits/main)入口；主分支提交本身不等同于已发布版本。

每个发布标签 `vYYYY.MM.DD`（同一天第二次发布起 `vYYYY.MM.DD.2`、`.3`…）对应这里一个同名 `.md` 文件，设置页「更新」tab 会显示它。

格式：每条一行，以「新增」「改进」「修复」开头，后面一句用户能看懂的话。不写 PR 号、函数名、内部术语。只对 Docker 或只对桌面版有效的改动，在句子里点明（例如「桌面版……」）。

    - 修复 巡检不会在一次运行里把同一个资源包转存两次
    - 新增 光鸭网盘支持转存别人分享的链接
    - 改进 转存中途失败留下的临时文件夹，系统会自己收拾干净

只有在作者自己的实例上验证过的 main 提交才打标签。流程：写好本文件 → 合并到 main → 在该提交上 `git tag vYYYY.MM.DD && git push origin vYYYY.MM.DD`。用轻量标签，不要加 `-a` 或 `-m`：带注释的标签不会被识别成发布版本。

推标签之后，发布流水线（`.github/workflows/release-desktop.yml`）会：

1. 先检查标签格式和本文件（没有「新增 / 改进 / 修复」开头的行就直接失败，不打包）；
2. 打 macOS、Windows 两个安装包，桌面版本号由标签推出（`v2026.09.28` → `2026.928.0`，`v2026.09.28.2` → `2026.928.2`），不用手改 `apps/desktop/package.json`；
3. 两个都通过后，在 GitHub 发布「巡影 vYYYY.MM.DD」，正文就是本文件（去掉标题）加一段下载说明。

想先试打包、不发布：在 Actions 里手动运行 Release Desktop，在「Run workflow」里选好要构建的分支，填标签、勾上 `dry_run`。dry run 构建的是你选的那条分支，不是标签指向的提交；标签只用来定版本号，以及核对哪一份发布说明。

如果几个标签推得比一次发布还快（大约 40 分钟），GitHub 只保留最新的一个排队任务，中间的标签可能被跳过。到 Actions 里用 workflow_dispatch 重跑那个标签即可；只要已经有更新的发布，它不会抢走「Latest」。
