/**
 * Generic OpenAI-compatible LLM HTTP client.
 */
import * as vscode from 'vscode';
import { LLM_MODEL_FAMILY, LLM_MAX_RETRIES, LLM_RETRY_BASE_DELAY_MS } from '../constants';

function isTransientError(err: any): boolean {
    const msg = (err.message || String(err)).toLowerCase();
    return msg.includes('no choices')
        || msg.includes('response contained no')
        || msg.includes('timeout')
        || msg.includes('econnreset')
        || msg.includes('rate limit');
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMResponse {
    content: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class LLMClient {
    async chat(
        messages: LLMMessage[],
        options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
    ): Promise<LLMResponse> {
        // Find the family of GPT-4o models using the official VS Code LM API selector
        const models = await vscode.lm.selectChatModels({ family: LLM_MODEL_FAMILY });

        if (models.length === 0) {
            throw new Error(
                `No ${LLM_MODEL_FAMILY} language model found. Please ensure you are signed into GitHub Copilot ` +
                'and your VS Code version supports the LM API.'
            );
        }

        // We will default to the first one available
        const model = models[0];

        // The VS Code LM API only supports Application, User and Assistant roles usually natively,
        // but it accepts LanguageModelChatMessage.User and LanguageModelChatMessage.Assistant.
        // We will concat system messages to the first user message.
        let systemPrompt = '';
        const vscodeMessages: vscode.LanguageModelChatMessage[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemPrompt += msg.content + '\n\n';
            } else if (msg.role === 'user') {
                vscodeMessages.push(
                    vscode.LanguageModelChatMessage.User(
                        systemPrompt ? systemPrompt + msg.content : msg.content
                    )
                );
                systemPrompt = ''; // Consume the system prompt
            } else if (msg.role === 'assistant') {
                vscodeMessages.push(
                    vscode.LanguageModelChatMessage.Assistant(msg.content)
                );
            }
        }

        // If the array only consisted of system messages, make sure we send at least one User message
        if (vscodeMessages.length === 0 && systemPrompt) {
            vscodeMessages.push(vscode.LanguageModelChatMessage.User(systemPrompt));
        }

        let token: vscode.CancellationToken | undefined;
        if (options?.signal) {
            const cts = new vscode.CancellationTokenSource();
            options.signal.addEventListener('abort', () => cts.cancel());
            if (options.signal.aborted) {
                cts.cancel();
            }
            token = cts.token;
        }

        for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
            try {
                const chatResponse = await model.sendRequest(
                    vscodeMessages,
                    { justification: 'To optimize and translate subtitles' },
                    token
                );

                let content = '';
                for await (const fragment of chatResponse.text) {
                    content += fragment;
                }

                return {
                    content,
                };
            } catch (err: any) {
                if (options?.signal?.aborted) {
                    throw new Error('Aborted');
                }
                if (attempt < LLM_MAX_RETRIES && isTransientError(err)) {
                    const backoff = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                    console.warn(`[LLMClient] Transient error (attempt ${attempt + 1}/${LLM_MAX_RETRIES}), retrying in ${backoff}ms: ${err.message || err}`);
                    await delay(backoff);
                    continue;
                }
                if (err instanceof vscode.LanguageModelError) {
                    throw new Error(`Copilot LM Error: ${err.message}`);
                }
                throw err;
            }
        }

        // Should not reach here, but satisfy TypeScript
        throw new Error('LLM request failed after all retries');
    }
}
