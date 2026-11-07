# 变更日志

## 0.1.3

- **每个包声明 `engines.dsh`**（`>=0.2.1-rc.5 <0.3.0`）：0.2.2 起宿主会按 `engines.dsh` / `@deepseek-ai/*` peers 判定插件兼容性，不满足默认**拒绝安装**。
  不声明就等于"对所有未来宿主都兼容"，装上 0.3.x 会在运行时才炸。
- **构建审计强制该字段**：必须存在、必须是 `>=floor <ceiling` 形式、必须能被当前运行时满足；版本号取自 `runtime.json`（可用 `DSH_RUNTIME_VERSION` 覆盖）。
- 补齐 `engines.node`。
- 新增 `verification/host-compat.test.mjs`：逐个 import 五个宿主半边并 apply，任何被移除的 API 都会在这里失败。
- 已按 0.2.2-rc.1 全量验证：公开契约（`dsh.client`/`exports["./client"]`、客户端模块 id、`connection.fetch.register`、`tools.register`、`dsh.bundle.patch`）逐项比对无变化。



## 0.1.2-alpha1

- **修复客户端模块 id**：五个浏览器半边把改名前的老包名硬编码成 `__ModuleLoader__.load({ id })`，
  Host 按新包名找不到就换 URL 重试，第二次注册同一 id 抛「duplicate factory registration」，
  整批客户端半边失效；修好后 id 与包名一致。
- **修复未发送备份的恢复链路**：`handleList` 调用了不存在的 `store.pruneMissingFiles`，
  导致每次 `/list` 都抛 TypeError —— 恢复流程第一步就失败，切会话后图片回不来。
  同时把 `handleReadImage` 里不存在的 `removeByAttachmentIds` 换成 `removeCommitted`。
- 新增 `verification/unsent-guard-host.test.mjs`：在进程内驱动真实的七个路由，
  覆盖 save-image → list → read-image → discard 全链路（这条 bug 就是它抓出来的）。
- 新增 POSIX 安装脚本 `install.sh`（macOS / Linux），与 `install.ps1` 等价；
  构建审计强制要求两个脚本都存在且在 `files` 里。

## 0.1.1

- pack 声明 `dependencies`：五个组件作为依赖一起装。profile 用 `nodeLinker: hoisted`，
  组件会被平铺到 profile 根目录 —— 正是 bundle 行解析包名的位置。于是插件页只填
  `@funniki/dsh-session-toolkit`（或一条 `dsh plugin add`）就能完整安装，不再需要手动装 6 个。
- `install.ps1`：先装 pack，再检测五行能否从 profile 根解析，缺的自动补齐（对非 hoisted 布局兜底）。
- `verify-profile.mjs`：改为按「能否从 profile 根解析」判定，不再要求 6 个都写进 manifest 的 dependencies。
- `build-release.cjs`：审计 pack 的依赖集合恰好是五个组件、且版本范围包含当前版本。
- 文档：补充「不要用仓库目录安装」（`link:` 安装的卸载会清空链接目标）。

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
