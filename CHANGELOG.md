# 变更日志

## 0.1.0 · 首个对外版本

已发布：npm 上 6 个包均为 `0.1.0` —— `@funniki/dsh-session-toolkit` 加五个
`@funniki/dsh-session-toolkit-*` 组件包；GitHub Release 附同名 zip。
一个插件包 + 五个组件，**零第三方依赖**；zip 与 npm 两个渠道同时发布。

### 五个组件

| 组件 | 作用 |
|---|---|
| `dsh-archived-session-delete` | 删除已归档会话，连同磁盘上的会话日志 |
| `dsh-session-move` | 把会话搬到另一个工作区（带备份、校验、失败回滚；开着也能搬） |
| `dsh-unsent-content-guard` | 备份未发送的输入内容与图片 |
| `dsh-session-history-search` | 关键词搜索历史会话（支持中文） |
| `dsh-auto-paste` | 长文本粘贴自动落盘为 `pastes/*.md` / `*.txt`，输入框只留带预览的引用卡片 |

### 安装方式

zip → 解压到固定目录 → `install.ps1`（内部是 6 次 `dsh plugin add`：pack + 5 个组件）。

> 为什么必须装 6 个：bundle 行的 `name` 只从 profile 根解析，pack 自带的
> `node_modules/` 对行解析不可见。只装 pack 会导致五个组件全部「未运行」。

### 本版关键改动：整包零第三方依赖

- `dsh-auto-paste` 重写为零依赖实现：
  - 宿主半边只 import `node:` 内置模块；`save_paste` 工具改为直接构造
    `ctx.tools.register()` 的定义（JSON Schema 取原先 `defineTool` 的编译结果）；
  - 原 Typert RPC 服务改为三条 `connection.fetch` 路由：
    `POST /api/auto-paste.save`、`/api/auto-paste.config`、`/api/auto-paste.threshold`；
  - 浏览器半边只 `require('react')`，调用改为普通 `fetch`；
  - 阈值持久化改为 `$DSH_HOME/auto-paste/user-config.json`（临时文件 + rename 原子写）。
- 删除 pack 内 vendored 依赖树（`@deepseek-ai/*`、`@standard-schema`、`zod`）与
  562 KB 的 `typert.host.js`：`plugin/node_modules` 从 14 MB 降到 372 KB，
  发布 zip 从 2.98 MB 降到约 110 KB。
- 新增 `tools/build-release.cjs`：同步 `components/` → `plugin/node_modules/`，
  并审计三类回归（带作用域的依赖进包、宿主半边 import 非 `node:` 模块、
  浏览器半边 require 非平台模块）。
- 补 `LICENSE`（MIT）与各包 `license` 字段，去掉 `private: true`。
- 为 npm 渠道将 6 个包名统一改为 `@funniki` scope：`@funniki/dsh-session-toolkit` 加五个
  `@funniki/dsh-session-toolkit-*`。行名跟着改成 scoped 名——裸名 `dsh-auto-paste`
  会和上游同名插件撞车，而 bundle 行本来就按包名从 profile 根解析。

### 已知限制

- 仅 Windows 提供安装脚本；其他平台按 README 的 6 条手动命令。
- 插件页里 `auto-paste` 不再有自动生成的配置表单（不再依赖 schemastery 的
  `Config`），阈值改在 设置 → 通用，或直接改 profile patch 的 `minChars`。
- git 历史里 `v2.3.9`–`v3.0.0` 那串 tag 属于**内部版本 / 已废弃的 npm 包实验**，
  不作为对外版本；对外从 `v0.1.0` 起算。
