import type { DeepSeekMessage, DeepSeekTool } from '../../types';
import {
	ACTIVATE_TOOL_PREFIX,
	TOOL_BUDGET_PINNED_HISTORY_TURNS,
	TOOL_NAME_PATTERN,
} from './consts';

/**
 * Tool budget: keep the DeepSeek `tools` array within a user-configured limit
 * without failing the request. The official API publishes no tool-count limit,
 * so there is none unless `deepseek-copilot.toolsLimit` sets one.
 *
 * This module is intentionally free of VS Code API dependencies so it can be
 * unit-tested as a pure function.
 */

export type ToolsLimitBehavior = 'trim' | 'error';

export interface ToolBudgetOptions {
	/** Converted tools in host (VS Code) order. */
	tools: readonly DeepSeekTool[] | undefined;
	limit: number;
	/** Converted conversation history, used to pin recently used tools. */
	messages: readonly DeepSeekMessage[];
	/** Reserve slots for `activate_*` virtual tools (tool-list stabilization). */
	reserveActivators: boolean;
}

export interface ToolBudgetResult {
	tools: DeepSeekTool[] | undefined;
	limit: number;
	/** Tool count after sanitization and before trimming. */
	total: number;
	kept: number;
	pinned: number;
	/** `total > limit`: the caller may throw in `error` mode. */
	exceeded: boolean;
	/** Tools were actually removed to satisfy the limit. */
	trimmed: boolean;
	dropped: string[];
	deduplicated: string[];
	invalid: string[];
}

export interface SanitizedTools {
	tools: DeepSeekTool[];
	deduplicated: string[];
	invalid: string[];
}

/** Configured limit, or `Infinity` (no trimming) when the setting is unset or 0. */
export function resolveToolsLimit(configuredLimit: number | undefined): number {
	if (configuredLimit !== undefined && Number.isFinite(configuredLimit) && configuredLimit > 0) {
		return Math.floor(configuredLimit);
	}
	return Number.POSITIVE_INFINITY;
}

/**
 * Drop tools DeepSeek would reject outright: duplicate names (first wins) and
 * names outside `[a-zA-Z0-9_-]{1,128}`. Host order is preserved.
 */
export function sanitizeTools(tools: readonly DeepSeekTool[]): SanitizedTools {
	const seen = new Set<string>();
	const result: DeepSeekTool[] = [];
	const deduplicated: string[] = [];
	const invalid: string[] = [];

	for (const tool of tools) {
		const name = tool.function.name;
		if (!TOOL_NAME_PATTERN.test(name)) {
			invalid.push(name);
			continue;
		}
		if (seen.has(name)) {
			deduplicated.push(name);
			continue;
		}
		seen.add(name);
		result.push(tool);
	}

	return { tools: result, deduplicated, invalid };
}

/**
 * Names of tools called by the assistant within the last `maxTurns` user turns,
 * most recent first. `activate_*` virtual tools are excluded: once called, the
 * group is already expanded and pinning the activator would waste a slot.
 */
export function collectRecentToolCallNames(
	messages: readonly DeepSeekMessage[],
	maxTurns = TOOL_BUDGET_PINNED_HISTORY_TURNS,
): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	let turns = 0;

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === 'user') {
			turns += 1;
			if (turns >= maxTurns) {
				break;
			}
			continue;
		}
		if (message.role !== 'assistant' || !message.tool_calls) {
			continue;
		}
		for (let callIndex = message.tool_calls.length - 1; callIndex >= 0; callIndex -= 1) {
			const name = message.tool_calls[callIndex].function.name;
			if (!name || name.startsWith(ACTIVATE_TOOL_PREFIX) || seen.has(name)) {
				continue;
			}
			seen.add(name);
			names.push(name);
		}
	}

	return names;
}

/**
 * Enforce `tools.length <= limit` deterministically.
 *
 * Selection priority when over the limit:
 * 1. tools recently called in this conversation (most recent first);
 * 2. not-yet-called `activate_*` virtual tools, when stabilization is on;
 * 3. the remaining tools in host order (VS Code lists built-in tools first).
 *
 * The final array always keeps host order regardless of priority, so expanding
 * a virtual tool group (which appends to the host list) leaves the first
 * `limit` entries untouched and the DeepSeek prefix cache intact.
 */
export function applyToolBudget({
	tools,
	limit,
	messages,
	reserveActivators,
}: ToolBudgetOptions): ToolBudgetResult {
	const sanitized = sanitizeTools(tools ?? []);
	const total = sanitized.tools.length;
	const base = {
		limit,
		total,
		deduplicated: sanitized.deduplicated,
		invalid: sanitized.invalid,
	};

	if (total <= limit) {
		return {
			...base,
			tools: total > 0 ? sanitized.tools : undefined,
			kept: total,
			pinned: 0,
			exceeded: false,
			trimmed: false,
			dropped: [],
		};
	}

	const available = new Map(sanitized.tools.map((tool) => [tool.function.name, tool]));
	const selected = new Set<string>();
	const select = (name: string): boolean => {
		if (selected.size >= limit || selected.has(name) || !available.has(name)) {
			return false;
		}
		selected.add(name);
		return true;
	};

	let pinned = 0;
	for (const name of collectRecentToolCallNames(messages)) {
		if (select(name)) {
			pinned += 1;
		}
	}

	if (reserveActivators) {
		for (const tool of sanitized.tools) {
			if (tool.function.name.startsWith(ACTIVATE_TOOL_PREFIX)) {
				select(tool.function.name);
			}
		}
	}

	for (const tool of sanitized.tools) {
		if (selected.size >= limit) {
			break;
		}
		select(tool.function.name);
	}

	const kept: DeepSeekTool[] = [];
	const dropped: string[] = [];
	for (const tool of sanitized.tools) {
		if (selected.has(tool.function.name)) {
			kept.push(tool);
		} else {
			dropped.push(tool.function.name);
		}
	}

	return {
		...base,
		tools: kept,
		kept: kept.length,
		pinned,
		exceeded: true,
		trimmed: dropped.length > 0,
		dropped,
	};
}

/** Stable fingerprint of what the budget removed; used to notify once per change. */
export function getToolBudgetFingerprint(budget: ToolBudgetResult): string {
	return budget.trimmed ? `${budget.limit}:${[...budget.dropped].sort().join(',')}` : '';
}
