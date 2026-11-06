# @funniki/dsh-session-toolkit-session-move

「会话功能增强」的一部分：把会话搬到另一个工作区。

- 会话「...」菜单 →「移动到工作区…」（至少需要两个工作区）；
- 搬的是整个会话：日志、附件、投影缓存，一起挪；
- 先在目标工作区落一份备份并校验，失败自动回滚；
- 支持热迁移：会话开着也能搬，搬完继续在新目录里对话；
- 目标工作区暂时不可写时把请求排进队列，稍后自动重试。

## 接口

- Host：`POST /api/session.move`、`/api/session.move.targets`、`/api/session.move.probe`
  （`connection` Fetch 通道），注入 `sessionPersistence` 与 `workspaceRegistry`；
- 浏览器：pack 的一行（`session-move`），通过 client slots 注册菜单项与对话框。

## 数据

备份与队列在 `$DSH_HOME/session-workspace-move/`（默认 `~/.dsh/session-workspace-move/`）。
可用行配置 `backupKeep` 调整保留份数、`retrySeconds` 调整重试间隔。

## 依赖

零第三方依赖：Host 半边只用 `node:` 内置模块，浏览器半边只 require 平台模块。

## 许可

MIT。
