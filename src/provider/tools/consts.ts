// DeepSeek Chat Completions API: "A max of 128 functions are supported."
// https://api-docs.deepseek.com/api/create-chat-completion#:~:text=A%20max%20of%20128%20functions%20are%20supported.
export const DEEPSEEK_TOOLS_LIMIT = 128;

// DeepSeek: function names "must be a-z, A-Z, 0-9, or contain underscores and
// dashes, with a maximum length of 128", and tool names must be unique.
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

// How many user turns back the tool budget looks for previously used tools
// (tools used recently are pinned so the model can continue what it started).
export const TOOL_BUDGET_PINNED_HISTORY_TURNS = 5;

// Synthetic tool result inserted for tool calls whose result never reached the
// history (for example when the user cancelled mid-tool). DeepSeek rejects
// assistant `tool_calls` without a matching `tool` message.
export const TOOL_CALL_CANCELLED_RESULT = 'Tool call was cancelled before a result was produced.';

export const ACTIVATE_TOOL_PREFIX = 'activate_';
export const PREFLIGHT_ACTIVATE_CALL_ID_PREFIX = 'deepseek_preflight_activate_';
export const MAX_PREFLIGHT_ROUNDS_PER_USER_REQUEST = 3;

export const TOOL_DRIFT_NOTICE_START = '[deepseek-copilot-tool-drift-notice-start]: #';
export const TOOL_DRIFT_NOTICE_END = '[deepseek-copilot-tool-drift-notice-end]: #';
export const TOOL_BUDGET_NOTICE_START = '[deepseek-copilot-tool-budget-notice-start]: #';
export const TOOL_BUDGET_NOTICE_END = '[deepseek-copilot-tool-budget-notice-end]: #';
export const VISION_PROXY_NOTICE_START = '[deepseek-copilot-vision-proxy-notice-start]: #';
export const VISION_PROXY_NOTICE_END = '[deepseek-copilot-vision-proxy-notice-end]: #';
