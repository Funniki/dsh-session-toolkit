# @funniki/dsh-session-toolkit-unsent-content-guard

「会话功能增强」的一部分：备份**没发出去**的输入内容。

输入框里的草稿和图片草稿只存在浏览器里，崩溃、重启、发送失败都会丢。这个组件把它们落盘留一份：

- 图片草稿：走挂载的附件服务 `saveImage` 归一化后按内容 id（`sha256:…`）保存；
- 文字草稿：按草稿文本摘要（含 trim 后的形式）保存；
- 只有成功的发送（会话日志里出现对应的 `user/message`）才会删掉备份；
  发送失败、草稿被清空、切会话、重启都保留备份。

## 接口

- Host：`/api/unsent-content/save-image`、`save-text`、`list`、`reveal`、`discard`、`probe`、`read-image`
  （`connection` Fetch 通道）；
- 浏览器：pack 的一行（`unsent-content-guard`），在输入框下方显示「未发送备份」胶囊。

## 数据

`$DSH_HOME/unsent-content/`（默认 `~/.dsh/unsent-content/`），含 `index.json` 索引。
卸载插件不会删除这些备份。

## 依赖

零第三方依赖：Host 半边只用 `node:` 内置模块，浏览器半边只 require 平台模块。

## 许可

MIT。
