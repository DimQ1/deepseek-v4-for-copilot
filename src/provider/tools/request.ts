import vscode from 'vscode';
import { t } from '../../i18n';
import type { DeepSeekMessage, DeepSeekTool } from '../../types';
import { convertTools } from '../convert';
import { applyToolBudget, type ToolBudgetResult, type ToolsLimitBehavior } from './budget';

export interface PrepareRequestToolsSettings {
	limit: number;
	behavior: ToolsLimitBehavior;
	stabilizeToolList: boolean;
}

export interface PreparedRequestTools {
	tools: DeepSeekTool[] | undefined;
	budget: ToolBudgetResult | undefined;
}

export function prepareRequestTools(
	toolCallingCapability: boolean | number | undefined,
	options: vscode.ProvideLanguageModelChatResponseOptions,
	messages: readonly DeepSeekMessage[],
	settings: PrepareRequestToolsSettings,
): PreparedRequestTools {
	const converted = toolCallingCapability ? convertTools(options.tools) : undefined;
	if (!converted) {
		return { tools: undefined, budget: undefined };
	}

	const budget = applyToolBudget({
		tools: converted,
		limit: settings.limit,
		messages,
		reserveActivators: settings.stabilizeToolList,
	});
	if (budget.exceeded && settings.behavior === 'error') {
		throw new Error(t('request.toolsLimitExceeded', settings.limit, budget.total));
	}
	return { tools: budget.tools, budget };
}

export function collectTrailingToolResultIds(messages: readonly DeepSeekMessage[]): string[] {
	const trailingToolResultIds: string[] = [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== 'tool' || !message.tool_call_id) {
			break;
		}
		trailingToolResultIds.push(message.tool_call_id);
	}
	return trailingToolResultIds.reverse();
}
