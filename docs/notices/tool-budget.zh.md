# 部分工具未随请求发送

DeepSeek V4 for Copilot Chat 发送给 DeepSeek 的工具数量少于当前会话中已启用的工具数量。

## 为什么会发生

DeepSeek Chat Completions API 单次请求最多接受 **128 个 functions**（`deepseek-copilot.toolsLimit`）。Copilot Chat 通常会把工具分组为 `activate_*` 虚拟工具，使列表保持在上限以内。以下情况仍会超出上限：

1. 调高了 `github.copilot.chat.virtualTools.threshold` 或将其设为 `0`（关闭分组）；
2. `deepseek-copilot.experimental.stabilizeToolList` 展开了虚拟工具分组。

扩展不再让请求失败，而是把列表裁剪到上限以内（`deepseek-copilot.toolsLimitBehavior: trim`）。

## 保留哪些工具

选择过程是确定性的，并保持 VS Code 的原始顺序，因此请求前缀保持稳定，DeepSeek 上下文缓存仍能命中：

1. 本次会话最近几轮中模型已经调用过的工具；
2. 尚未展开的 `activate_*` 虚拟工具（仅在开启稳定工具列表时）；
3. 其余工具按 VS Code 顺序保留。内置工具排在前面，其后是扩展和 MCP 工具。

重复的工具名以及不符合 `[a-zA-Z0-9_-]{1,128}` 的名称也会被丢弃，因为 DeepSeek 会拒绝它们。

如果模型调用了被省略的工具，该调用仍会传给 Copilot，并且该工具会在下一轮被保留。

## 你可以怎么做

1. 运行 **配置工具**（`workbench.action.chat.configureTools`），禁用本次会话不需要的工具或 MCP 服务器；
2. 保持 `github.copilot.chat.virtualTools.threshold` 为默认值，让 Copilot 自行分组；
3. 如果希望请求直接失败，把 `deepseek-copilot.toolsLimitBehavior` 设为 `error`。

该提示在每个会话中只显示一次，仅当被省略的工具集合发生变化时才会再次显示。在 `deepseek-copilot.debugMode: metadata` 下，日志会输出仅包含计数的 `[tool-budget]` 行。
