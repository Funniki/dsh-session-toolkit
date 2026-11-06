# 会话功能增强 · dsh-session-toolkit 0.1.0

给 DeepSeek Harness 增加五个会话与输入功能。插件列表中显示一个「会话功能增强」条目，五个组件保留各自的名称、图标和开关。

主包和五个组件均为 **0.1.0**，不附带 `@deepseek-ai/*`、`zod` 等第三方运行时依赖。宿主端使用 Node 内置模块，浏览器端使用 DSH 提供的 React。

| 组件 | 用途 |
|---|---|
| `dsh-archived-session-delete` | 永久删除已归档会话及其日志 |
| `dsh-session-move` | 跨工作区移动会话，支持备份、校验、失败回滚及空闲会话热迁移 |
| `dsh-unsent-content-guard` | 备份未发送的文字与图片 |
| `dsh-session-history-search` | 按关键词搜索历史消息，支持中文 |
| `dsh-auto-paste` | 将长文本保存为工作区中的 Markdown 或文本附件，并在输入框显示引用卡片 |

## 安装

**必须把主包和五个组件都安装到同一个 DSH profile。** 只添加外层目录不会自动安装五个组件，会出现「未运行」或 `Cannot find package`。

1. 从 [GitHub Releases](https://github.com/Funniki/dsh-session-toolkit/releases) 下载 `dsh-session-toolkit-0.1.0.zip`。
2. 解压到固定目录，进入包含本说明、`package.json` 和 `install.ps1` 的那一层。
3. Windows 下运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

   安装到其他 profile 时可加 `-Profile <名称>`。脚本会依次安装主包和五个组件。
4. 重启 DSH，或在插件页关闭再启用「会话功能增强」，然后确认五个组件均已运行。

本地安装采用目录链接，安装后请保留解压目录的位置和内容。手动安装及排查步骤见同目录的 [安装说明](安装说明.md)。

本版本通过 GitHub Release 的 ZIP 分发；npm 渠道另行发布。GitHub 自动生成的 Source code 压缩包是源码，不等同于安装包。

## 配置

长文本转换默认阈值为 500 字符，单次大小上限为 1 MiB。可以在「设置 → 通用 → 大段粘贴阈值」中修改阈值；用户设置保存在 `$DSH_HOME/auto-paste/user-config.json`。部署默认值由 `cordis.patch.yml` 中的 `minChars`、`maxBytes` 控制。

零依赖实现不再提供原先依赖 schemastery 的自动生成配置表单。

## 兼容性与使用边界

- 已验证环境为 DSH `0.2.1-rc.5`、V4 会话日志格式。其他版本需要另行验证。
- 会话运行中请等待当前轮次结束后再移动；空闲的已打开会话支持热迁移，无法直接迁移时可能需要重启后处理。
- 删除已归档会话不可恢复。
- 卸载插件不会自动删除迁移备份、未发送内容备份或工作区中的 `pastes/` 文件。

## 开发与许可证

源码、构建方式和验证脚本见 [GitHub 仓库](https://github.com/Funniki/dsh-session-toolkit)。组件源码在仓库的 `components/` 中，发布时由构建脚本同步到本目录的 `node_modules/`。

MIT，见 [LICENSE](LICENSE)。auto-paste 保留上游许可证和第三方声明，随组件一起分发。
