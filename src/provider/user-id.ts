import { randomUUID } from 'crypto';
import type vscode from 'vscode';
import { USER_ID_STATE_KEY } from '../consts';
import { logger } from '../logger';

const USER_ID_PREFIX = 'vscode-';
// DeepSeek: `user_id` must match [a-zA-Z0-9\-_]+ and be at most 512 characters.
const USER_ID_PATTERN = /^[a-zA-Z0-9\-_]{1,512}$/;

/**
 * Stable anonymous identifier for the DeepSeek `user_id` request field
 * (per-user KV cache, scheduling, and content-safety isolation). Generated once
 * per VS Code installation and never derived from user data.
 */
export function getOrCreateAnonymousUserId(globalState: vscode.Memento): string {
	const existing = globalState.get<string>(USER_ID_STATE_KEY);
	if (existing && USER_ID_PATTERN.test(existing)) {
		return existing;
	}

	const created = `${USER_ID_PREFIX}${randomUUID()}`;
	void Promise.resolve(globalState.update(USER_ID_STATE_KEY, created)).catch((error) => {
		logger.warn('Failed to persist DeepSeek anonymous user id', error);
	});
	return created;
}
