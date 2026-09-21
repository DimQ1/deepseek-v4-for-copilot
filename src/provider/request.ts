import vscode from 'vscode';
import { AuthManager } from '../auth';
import { createApiKeyNotConfiguredError, DeepSeekClient } from '../client';
import {
	getApiModelId,
	getBaseUrl,
	getMaxTokens,
	getRequestHeaders,
	getStabilizeToolListEnabled,
	getToolsLimit,
	getToolsLimitBehavior,
} from '../config';
import { MODELS } from '../consts';
import { isOfficialDeepSeekBaseUrl } from '../endpoint';
import type { DeepSeekRequest } from '../types';
import { convertMessages, countMessageChars } from './convert';
import {
	dumpDeepSeekRequest,
	logToolBudgetDiagnostics,
	logToolPairingDiagnostics,
	type CacheDiagnosticsRecorder,
	type CacheDiagnosticsRun,
} from './debug';
import { resolveRequestHeaders } from './headers';
import {
	getConfiguredThinkingEffort,
	type ModelConfigurationOptions,
	type ThinkingEffort,
} from './models';
import type { ReplayMarkerMetadata } from './replay';
import { classifyDeepSeekRequest, shouldForceThinkingNone, type RequestKind } from './routing';
import type { ConversationSegment } from './segment';
import { resolveToolsLimit, type ToolBudgetResult } from './tools/budget';
import { repairToolCallPairing } from './tools/pairing';
import { collectTrailingToolResultIds, prepareRequestTools } from './tools/request';
import {
	finalizeVisionResolutionStats,
	prepareVisionMessages,
	type VisionDescriber,
} from './vision';

export interface PreparedChatRequest {
	client: DeepSeekClient;
	request: DeepSeekRequest;
	isThinkingModel: boolean;
	totalRequestChars: number;
	hasNativeImages: boolean;
	trailingToolResultIds: string[];
	cacheDiagnostics: CacheDiagnosticsRun;
	requestKind: RequestKind;
	segment: ConversationSegment;
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionMarkerTextChars?: number;
	initialResponseNotice?: string;
	toolBudget?: ToolBudgetResult;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	globalStorageUri: vscode.Uri;
	storageUri?: vscode.Uri;
	modelInfo: vscode.LanguageModelChatInformation;
	segment: ConversationSegment;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
	cacheDiagnostics: CacheDiagnosticsRecorder;
	getVisionDescriber: () => Promise<VisionDescriber | undefined>;
	/** Stable anonymous DeepSeek `user_id`; omitted unless the opt-in setting is on. */
	userId?: string;
}

export async function prepareChatRequest({
	authManager,
	globalStorageUri,
	storageUri,
	modelInfo,
	segment,
	messages,
	options,
	token,
	cacheDiagnostics,
	getVisionDescriber,
	userId,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw createApiKeyNotConfiguredError();
	}

	const baseUrl = getBaseUrl();
	const requestHeaders = resolveRequestHeaders(getRequestHeaders(), options, storageUri);
	const client = new DeepSeekClient(baseUrl, apiKey, requestHeaders);
	const modelDef = MODELS.find((m) => m.id === modelInfo.id);
	const thinkingCapability = modelDef?.capabilities.thinking;
	const isThinkingModel = Boolean(thinkingCapability);
	const nativeImageInput = modelDef?.capabilities.nativeImageInput === true;
	const maxTokens = getMaxTokens();
	const visionResolution = await prepareVisionMessages({
		messages,
		nativeImageInput,
		token,
		getDescriber: getVisionDescriber,
	});

	const resolvedMessages = visionResolution.messages;

	const pairing = repairToolCallPairing(
		convertMessages(resolvedMessages, isThinkingModel, nativeImageInput),
	);
	const deepseekMessages = pairing.messages;
	finalizeVisionResolutionStats(visionResolution.stats, deepseekMessages);

	const { tools, budget: toolBudget } = prepareRequestTools(
		modelDef?.capabilities.toolCalling,
		options,
		deepseekMessages,
		{
			limit: resolveToolsLimit(getToolsLimit(), modelDef?.capabilities.toolCalling),
			behavior: getToolsLimitBehavior(),
			stabilizeToolList: getStabilizeToolListEnabled(),
		},
	);

	const totalRequestChars = countMessageChars(deepseekMessages);
	const hasNativeImages =
		visionResolution.stats.imageHandlingMode === 'native' &&
		visionResolution.stats.input.forwardedImageParts +
			visionResolution.stats.tool.forwardedImageParts >
			0;
	const baseRequest: DeepSeekRequest = {
		model: getApiModelId(modelInfo.id),
		messages: deepseekMessages,
		stream: true,
		tools,
		tool_choice: tools && tools.length > 0 ? ('auto' as const) : undefined,
		max_tokens: maxTokens,
		...(userId ? { user_id: userId } : {}),
	};
	const requestKind = classifyDeepSeekRequest({
		request: baseRequest,
		inputMessages: messages,
	});
	logToolPairingDiagnostics({
		requestKind,
		orphanToolCalls: pairing.orphanToolCalls,
		orphanToolResults: pairing.orphanToolResults,
	});
	logToolBudgetDiagnostics({ requestKind, budget: toolBudget });
	const configuredThinkingEffort = thinkingCapability
		? getConfiguredThinkingEffort(options as ModelConfigurationOptions, thinkingCapability)
		: 'none';
	// Only force helper requests into disabled thinking on the official API.
	// Custom endpoints keep their configured effort to preserve pre-#137 request shape.
	const forceNoneThinking =
		shouldForceThinkingNone(requestKind) && isOfficialDeepSeekBaseUrl(baseUrl);
	const thinkingEffort = forceNoneThinking ? 'none' : configuredThinkingEffort;
	const request: DeepSeekRequest = {
		...baseRequest,
		tool_choice: resolveToolChoice(baseRequest.tool_choice, options.toolMode, thinkingEffort),
		...(isThinkingModel
			? {
					thinking: {
						type: thinkingEffort === 'none' ? ('disabled' as const) : ('enabled' as const),
					},
					...(thinkingEffort === 'none' ? {} : { reasoning_effort: thinkingEffort }),
				}
			: {}),
	};
	dumpDeepSeekRequest(request, {
		globalStorageUri,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		requestOptions: options,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
		toolBudget,
	});

	const diagnosticsRun = cacheDiagnostics.beginRequest({
		request,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
	});

	return {
		client,
		request,
		isThinkingModel,
		totalRequestChars,
		hasNativeImages,
		trailingToolResultIds: collectTrailingToolResultIds(deepseekMessages),
		cacheDiagnostics: diagnosticsRun,
		requestKind,
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
		initialResponseNotice: visionResolution.initialResponseNotice,
		toolBudget,
	};
}

/**
 * DeepSeek rejects `tool_choice: required` in thinking mode (HTTP 400), so the
 * host's Required tool mode is honored only when thinking is disabled for this
 * request (typically Copilot helper requests with a single tool).
 */
function resolveToolChoice(
	baseToolChoice: DeepSeekRequest['tool_choice'],
	toolMode: vscode.LanguageModelChatToolMode | undefined,
	thinkingEffort: ThinkingEffort,
): DeepSeekRequest['tool_choice'] {
	if (
		baseToolChoice === 'auto' &&
		toolMode === vscode.LanguageModelChatToolMode.Required &&
		thinkingEffort === 'none'
	) {
		return 'required';
	}
	return baseToolChoice;
}
