# @funniki/dsh-session-toolkit-archived-session-delete

「会话功能增强」的一部分：删除已归档会话，连同磁盘上的会话日志。

- **侧栏行**：鼠标悬停在已归档会话上时出现一个红色删除按钮；
- **会话菜单**：分组菜单里多一项「删除已归档会话」；
- 删除前会先停掉会话、核对活动状态，再移除投影缓存和磁盘上的会话文件。

## 接口

- Host：`POST /api/session.delete`（`connection` Fetch 通道），只接受已归档会话；
- 浏览器：插件包的一行（`archived-session-delete`），通过 client slots 注册侧栏与菜单项；
- 这是 pack 的一个组件，不单独作为 bundle 安装——行由 pack 的 `cordis.patch.yml` 插入。

## 依赖

零第三方依赖：Host 半边只用 `node:` 内置模块，浏览器半边只 require 平台模块。

## 许可

MIT。
