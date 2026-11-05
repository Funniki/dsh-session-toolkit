# 长文本转附件（dsh-auto-paste 组件）

粘贴超过阈值的长文本时，自动保存为当前会话工作区 `pastes/` 下的附件，输入框里只留一张带**开头预览**的引用卡片；模型收到的是 `@"pastes/xxx.md"` 这样的一行引用，不占上下文。

本组件 fork 自 [`dsh-auto-paste@0.3.2`](https://github.com/sakuraqqq/dsh-auto-paste)（MIT，作者 misakamaster），作为「会话功能增强」的第 5 个组件，改动如下：

## 与原版的差异

| 项 | 原版 0.3.2 | 本组件 |
|---|---|---|
| 文件扩展名 | 一律 `.txt` | **按内容检测**：有 Markdown 标题（`#`）、代码块（```）、列表、引用、链接或表格 → **`.md`**，否则 `.txt` |
| 输入框卡片 | `文件名 · N 字符` | `文件名 · 开头 24 字… · N 字符`（**开头预览**） |
| 阈值配置 | row config `minChars` + 设置页 | 保留：**组件 row config**（插件页 → 本组件 → 配置）与 设置 → 通用 里的「大段粘贴阈值」两处都可改 |

其余能力（粘贴拦截、宿主落盘、冲突重命名、`maxBytes` 上限、失败回退原文、`save_paste` 工具）沿用上游实现。

## 配置

组件行的 `config`：

```yaml
- id: auto-paste
  name: 'dsh-auto-paste'
  config:
    minChars: 500        # 触发阈值（字符）
    maxBytes: 1048576    # 单次粘贴字节上限（硬顶 64 MiB）
```

也可以在 **设置 → 通用 → 大段粘贴阈值** 即时修改（写入 profile patch）。

## 行为

- 粘贴 ≥ `minChars` → 文本写入 `<工作区>/pastes/<时间戳>.<md|txt>`；
- 输入框插入官方引用卡片（atomic chip），标签带开头预览与字符数，点击右侧栏打开；
- 消息发送后模型只收到 `@"pastes/xxx.md"` 引用；
- 保存失败自动回退为原文粘贴，不丢内容。

## 归属

上游 MIT 许可与第三方声明见同目录 `LICENSE`、`THIRD_PARTY_NOTICES.md`；上游 README 见发布包（本组件未重复收录）。
