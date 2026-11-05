# 会话历史搜索（dsh-session-history-search）

**在历史消息里按关键词检索**，重点解决中文检索：DSH 自带的侧边栏搜索（Ctrl+K）只过滤会话标题，内置全文索引默认关闭且 FTS5 `unicode61` 分词对连续中文句子几乎无法命中。本插件改用**字面子串扫描**（大小写不敏感，中文可直接命中），并缓存每个会话的消息文本（按持久化 revision 失效），首次搜索稍慢、之后很快。

## 功能

- 输入框下方新增一个「搜索历史」小按钮（和「未发送备份」同一排），点击弹出**小窗搜索**；也可用快捷键 **Ctrl+Shift+K** 直接弹出；
- 小窗：顶部输入框（Esc 关闭、点遮罩关闭），下方结果列表，点击结果打开会话并关闭窗口；
- 输入关键词 → 返回命中消息列表：会话标题、角色（我/助手）、时间、命中上下文片段（关键词高亮）；
- 搜索范围：当前工作区可见的、非 subagent 的历史会话（最多 400 个），只看 `user/message` 与 `assistant/message` 的当前内容（surface=current）。

## 实现要点

- 宿主路由 `POST /api/session-search/query`：用 `sessionQuery.filterEvents(sessionId, [{kind:'type',...},{kind:'surface',values:['current']}])` 读取每个会话的消息文本，做 `toLowerCase().includes(query)` 子串匹配——**不依赖 FTS，也不需要开启 openAt**，中文子串可命中；
- 缓存：`Map<sessionId, {revision, messages}>`，用 `sessionPersistence.list()` 的 revision 判断是否需要重建；
- 标题：`sessionQuery.readTitleSnapshots()` 批量补齐；没有标题时回退工作区目录名；
- 客户端：注册 `main` 面板（key `session-history-search`）+ `sidebar.panellist` 图标，点击结果调用 `uiWorkspace.openSession()`。

## 配置（可选）

```yaml
- id: session-history-search
  config:
    selfTest: true       # 启动后跑一次中文 + 英文查询，写 ~/.dsh/session-history-search/selftest.json
    selfTestQuery: 会话
```

## 已知边界

- 首轮搜索需要读取各会话日志（大日志会话可能耗时 1–2 秒），之后走缓存；
- 只检索 `user/message` / `assistant/message` 的当前内容，不检索工具结果、推理过程与已折叠的历史版本；
- 子串匹配不做分词/同义词：输入越具体越准；
- 最多扫描 400 个会话、默认返回 40 条命中（可传 `limit`，上限 100）。

## 跳转

点击搜索结果后：

1. 若当前打开的会话已经包含这条命中（同会话），**不会重新打开会话**，避免聊天自己释放/重建会话引用导致「加载更早」失效；
2. 优先使用聊天自带的**轮次导航**跳到命中的轮次（会自动补加载历史），再在轮次内找到包含关键词的消息并滚动、高亮；
3. 宿主返回的命中里带 1 基的 `turn`；若宿主代码尚未重载（拿不到 turn），退化为点击「加载更早」逐页加载并滚动到命中文本。

> 宿主侧 turn 字段的改动需要 DSH 完全重启后生效；客户端换包后刷新页面即可。
