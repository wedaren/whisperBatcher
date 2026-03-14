/**
 * LLM 客户端。
 * 当前实现不直接调用 HTTP，而是通过 VS Code LM API 选择并请求 Copilot 可用模型。
 */
import * as vscode from 'vscode';
import { LLM_MODEL_FAMILY, LLM_MAX_RETRIES, LLM_RETRY_BASE_DELAY_MS } from '../constants';

function isTransientError(err: any): boolean {
    // 这些错误更像瞬态问题，适合退避重试。
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
        // 通过 family 选择当前 VS Code / Copilot 可用的模型。
        const models = await vscode.lm.selectChatModels({ family: LLM_MODEL_FAMILY });

        if (models.length === 0) {
            throw new Error(
                `No ${LLM_MODEL_FAMILY} language model found. Please ensure you are signed into GitHub Copilot ` +
                'and your VS Code version supports the LM API.'
            );
        }

        // 当前策略直接使用第一个可用模型。
        const model = models[0];

        // VS Code LM API 没有独立的 system role，这里把 system 提示拼接到首个 user 消息。
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
                systemPrompt = ''; // 这一段 system 提示已经消费完成
            } else if (msg.role === 'assistant') {
                vscodeMessages.push(
                    vscode.LanguageModelChatMessage.Assistant(msg.content)
                );
            }
        }

        // 如果只有 system 消息，补一个 user 消息，满足 LM API 输入要求。
        if (vscodeMessages.length === 0 && systemPrompt) {
            vscodeMessages.push(vscode.LanguageModelChatMessage.User(systemPrompt));
        }

        let token: vscode.CancellationToken | undefined;
        if (options?.signal) {
            // 将标准 AbortSignal 转换为 VS Code 的取消令牌。
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
                    // 对瞬态错误使用指数退避，避免立刻失败。
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

        // 理论上不应执行到这里，仅用于满足 TypeScript 返回路径检查。
        throw new Error('LLM request failed after all retries');
    }
}
