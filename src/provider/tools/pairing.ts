import type { DeepSeekMessage } from '../../types';
import { TOOL_CALL_CANCELLED_RESULT } from './consts';

/**
 * DeepSeek (like OpenAI) requires every assistant `tool_calls` entry to be
 * followed by a `tool` message with the matching `tool_call_id`, and rejects
 * `tool` messages that do not answer a preceding call. Copilot history can
 * violate this after a cancelled tool call; the whole conversation then fails
 * with HTTP 400 on every turn. Repair the pairing instead.
 *
 * Pure function: no VS Code API dependencies.
 */

export interface ToolPairingRepair {
	messages: DeepSeekMessage[];
	/** Assistant tool calls that received a synthetic "cancelled" result. */
	orphanToolCalls: number;
	/** Tool result messages dropped because nothing requested them. */
	orphanToolResults: number;
}

export function repairToolCallPairing(messages: readonly DeepSeekMessage[]): ToolPairingRepair {
	const result: DeepSeekMessage[] = [];
	let orphanToolCalls = 0;
	let orphanToolResults = 0;
	let index = 0;

	while (index < messages.length) {
		const message = messages[index];

		if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
			result.push(message);
			const expectedIds = new Set(message.tool_calls.map((call) => call.id));
			const answeredIds = new Set<string>();

			let next = index + 1;
			while (next < messages.length && messages[next].role === 'tool') {
				const toolMessage = messages[next];
				const callId = toolMessage.tool_call_id;
				if (callId && expectedIds.has(callId) && !answeredIds.has(callId)) {
					answeredIds.add(callId);
					result.push(toolMessage);
				} else {
					orphanToolResults += 1;
				}
				next += 1;
			}

			for (const call of message.tool_calls) {
				if (answeredIds.has(call.id)) {
					continue;
				}
				orphanToolCalls += 1;
				result.push({
					role: 'tool',
					tool_call_id: call.id,
					content: TOOL_CALL_CANCELLED_RESULT,
				});
			}

			index = next;
			continue;
		}

		if (message.role === 'tool') {
			orphanToolResults += 1;
			index += 1;
			continue;
		}

		result.push(message);
		index += 1;
	}

	return {
		messages: orphanToolCalls === 0 && orphanToolResults === 0 ? [...messages] : result,
		orphanToolCalls,
		orphanToolResults,
	};
}
