# Some Tools Were Left Out of the Request

DeepSeek V4 for Copilot Chat sent fewer tools to DeepSeek than you have enabled in this chat.

## Why This Happens

The DeepSeek Chat Completions API accepts at most **128 functions** in one request (`deepseek-copilot.toolsLimit`). Copilot Chat normally keeps the list under this limit by grouping tools into `activate_*` virtual tools. The limit is still exceeded when:

1. `github.copilot.chat.virtualTools.threshold` was raised or set to `0` (grouping disabled), or
2. `deepseek-copilot.experimental.stabilizeToolList` expanded the virtual tool groups.

Instead of failing the request, the extension now trims the list to the limit (`deepseek-copilot.toolsLimitBehavior: trim`).

## What Is Kept

Selection is deterministic and keeps VS Code's order, so the request prefix stays stable and the DeepSeek context cache keeps hitting:

1. Tools the model already called in the last few turns of this conversation.
2. `activate_*` virtual tools that have not been expanded yet (only with tool-list stabilization on).
3. The remaining tools in VS Code order. Built-in tools come first, then extension and MCP tools.

Duplicate tool names and names outside `[a-zA-Z0-9_-]{1,128}` are dropped as well, because DeepSeek rejects them.

If the model calls a tool that was left out, the call still reaches Copilot, and that tool is kept on the next turn.

## What You Can Do

1. Run **Configure Tools** (`workbench.action.chat.configureTools`) and disable tools or MCP servers you do not need in this chat.
2. Keep `github.copilot.chat.virtualTools.threshold` at its default so Copilot groups tools itself.
3. Set `deepseek-copilot.toolsLimitBehavior` to `error` if you prefer the request to fail instead.

The notice is shown once per conversation and again only when the set of omitted tools changes. With `deepseek-copilot.debugMode: metadata`, the log shows a `[tool-budget]` line with counts only.
