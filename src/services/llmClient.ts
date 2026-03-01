/**
 * Generic OpenAI-compatible LLM HTTP client.
 */
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

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
        const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });

        if (models.length === 0) {
            throw new Error(
                'No gpt-4o language model found. Please ensure you are signed into GitHub Copilot ' +
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
            if (err instanceof vscode.LanguageModelError) {
                throw new Error(`Copilot LM Error: ${err.message}`);
            }
            throw err;
        }
    }
}
