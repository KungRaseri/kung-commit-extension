import { Config } from './config';

// ---------------------------------------------------------------------------
// AI Provider Interface
// ---------------------------------------------------------------------------

export interface AIProvider {
    generateCommitMessage(diff: string): Promise<string>;
    /** Generate a PR title and description from a branch diff. */
    generatePRDescription(diff: string, baseBranch?: string, headBranch?: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Retry utility with exponential backoff
// ---------------------------------------------------------------------------

interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 10000 },
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;

            // Retry only on network errors, rate limits (429), and server errors (5xx)
            const shouldRetry = isRetryableError(error);
            if (!shouldRetry || attempt === options.maxRetries) {
                throw error;
            }

            // Exponential backoff with jitter
            const delay = Math.min(
                options.baseDelayMs * Math.pow(2, attempt),
                options.maxDelayMs,
            );
            const jitter = Math.random() * 0.3 * delay;
            await sleep(delay + jitter);
        }
    }

    throw lastError ?? new Error('Retry failed');
}

function isRetryableError(error: any): boolean {
    // Retry on rate limits (429) and server errors (5xx)
    if (error.status === 429 || (error.status >= 500 && error.status < 600)) {
        return true;
    }
    // For errors without an HTTP status, only retry if the message contains
    // network-related keywords indicating a transient failure.
    if (error.status === undefined) {
        const msg = (error.message || '').toLowerCase();
        const networkKeywords = [
            'econnreset',
            'etimedout',
            'socket hang up',
            'network error',
            'fetch failed',
        ];
        if (networkKeywords.some(keyword => msg.includes(keyword))) {
            return true;
        }
        if (error.name === 'TypeError' && msg.includes('fetch')) {
            return true;
        }
    }
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Response sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize the AI-generated commit message by stripping common
 * explanatory prefixes, markdown formatting, and code fences that
 * some models add despite prompt instructions telling them not to.
 *
 * Strategy (in order):
 *   1. Strip markdown code fences (``` ... ```)
 *   2. Strip known explanatory prefixes (case-insensitive)
 *   3. If the text contains a conventional-commit line after fluff,
 *      extract from that line onward
 *   4. Trim and return
 *
 * Always returns a non-empty string (falls back to the original raw text).
 */
function sanitizeCommitMessage(raw: string): string {
    let message = raw.trim();

    // 1. Strip markdown code fences wrapping the entire message
    //    e.g. ```\nfeat: foo\n```  →  feat: foo
    message = message.replace(/^```[\w]*\s*\n/gm, '').replace(/\n```\s*$/gm, '');
    message = message.trim();

    // 2. Strip common explanatory prefixes (case-insensitive)
    const prefixPatterns = [
        /^(here is|the commit message is|commit message:|suggested commit message:|i suggest|here's|recommended commit message:|the recommended commit message is)[:\s]*\n*/i,
    ];

    for (const pattern of prefixPatterns) {
        const match = message.match(pattern);
        if (match) {
            message = message.substring(match[0].length).trim();
            break;
        }
    }

    // 3. If the message contains a conventional-commit line anywhere after
    //    some fluff text, extract from that line onward.
    //    e.g. "Based on the diff, here is the commit:\nfeat(auth): add login\n..."
    //    →   "feat(auth): add login\n..."
    const conventionalCommitRegex =
        /^(feat|fix|chore|docs|style|refactor|perf|test|ci|build|revert)(\(.+?\))?:\s*.+/m;
    const ccMatch = message.match(conventionalCommitRegex);
    if (ccMatch && ccMatch.index !== undefined && ccMatch.index > 0) {
        message = message.substring(ccMatch.index).trim();
    }

    return message || raw.trim();
}

// ---------------------------------------------------------------------------
// Base provider with shared logic
// ---------------------------------------------------------------------------

abstract class BaseProvider {
    protected config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    // -----------------------------------------------------------------------
    // Commit message prompts
    // -----------------------------------------------------------------------

    protected buildUserPrompt(diff: string): string {
        const template = this.config.promptTemplate;
        return template.replace('{{diff}}', diff);
    }

    protected buildSystemPrompt(): string {
        const locale = this.config.locale;
        const localeInstruction =
            locale !== 'en'
                ? `\nRespond in ${locale}.`
                : '';

        return (
            `You are an expert developer generating a concise conventional commit message.` +
            localeInstruction +
            `\n\n` +
            `CRITICAL: Your entire response must be ONLY the raw commit message. ` +
            `Do NOT include ANY explanation, reasoning, commentary, analysis, ` +
            `markdown formatting, code blocks, backticks, or prefixes like ` +
            `"Here is" or "The commit message". Output the commit message directly.` +
            `\n\n` +
            `IMPORTANT: Consider ALL changes in the diff. Summarize the entire set of ` +
            `modifications into one cohesive commit message. Do NOT focus on just one ` +
            `file or one change — your message must reflect the overall diff.` +
            `\n\n` +
            `Use the format: <type>(<scope>): <description>\n\n` +
            `Types: feat, fix, chore, docs, style, refactor, perf, test, ci, build, revert\n\n` +
            `Keep the first line under 72 characters. Focus on the WHAT and WHY, not the HOW.` +
            ` If there are multiple logical changes, use a short summary as the header` +
            ` with bullet points for details.`
        );
    }

    // -----------------------------------------------------------------------
    // PR description prompts
    // -----------------------------------------------------------------------

    /**
     * Build the user prompt for PR description generation.
     * Supports {{diff}}, {{baseBranch}}, {{headBranch}} placeholders.
     */
    protected buildPRUserPrompt(diff: string, baseBranch?: string, headBranch?: string): string {
        const template = this.config.prPromptTemplate;
        return template
            .replace('{{diff}}', diff)
            .replace('{{baseBranch}}', baseBranch || 'base')
            .replace('{{headBranch}}', headBranch || 'HEAD');
    }

    protected buildPRSystemPrompt(): string {
        const locale = this.config.locale;
        const localeInstruction =
            locale !== 'en'
                ? `\nRespond in ${locale}.`
                : '';

        return (
            `You are an expert developer reviewing a pull request.` +
            localeInstruction +
            `\n\n` +
            `Generate a clear, structured PR title and description based on the git diff provided.` +
            ` The first line of your response MUST be the PR title only (max 72 characters).` +
            ` After a blank line, provide the full description body using Markdown.` +
            ` Include sections for Summary, Changes, Breaking Changes, and Related Issues.` +
            ` Focus on the WHAT and WHY, not the HOW.`
        );
    }

    // -----------------------------------------------------------------------
    // Shared
    // -----------------------------------------------------------------------

    protected getApiKey(): string {
        return this.config.apiKey || process.env.KUNG_COMMIT_API_KEY || '';
    }

    /**
     * Wrap the actual provider call in retry logic, then sanitize the
     * response to strip any explanation or reasoning the model may have
     * included despite prompt instructions.
     * Subclasses implement `doGenerate(diff): string`.
     */
    async generateCommitMessage(diff: string): Promise<string> {
        const raw = await withRetry(() => this.doGenerate(diff));
        return sanitizeCommitMessage(raw);
    }

    /**
     * Generate a PR title and description from a branch diff.
     * Subclasses implement `doGeneratePR(diff): string`.
     */
    async generatePRDescription(diff: string, baseBranch?: string, headBranch?: string): Promise<string> {
        return withRetry(() => this.doGeneratePR(diff, baseBranch, headBranch));
    }

    protected abstract doGenerate(diff: string): Promise<string>;

    /**
     * Protected PR generation method — each provider overrides this to
     * use its own API endpoint while leveraging PR-specific prompts.
     */
    protected abstract doGeneratePR(diff: string, baseBranch?: string, headBranch?: string): Promise<string>;

    /**
     * Helper to parse a JSON response from an OpenAI-compatible API.
     */
    protected parseOpenAIResponse(data: any): string {
        return (data.choices?.[0]?.message?.content || '').trim();
    }

    /**
     * Helper to parse a JSON response from the Anthropic Messages API.
     */
    protected parseAnthropicResponse(data: any): string {
        return (data.content?.[0]?.text || '').trim();
    }
}

// ---------------------------------------------------------------------------
// OpenAI Provider
// ---------------------------------------------------------------------------

export class OpenAIProvider extends BaseProvider implements AIProvider {
    protected async doGenerate(diff: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw Object.assign(new Error('OpenAI API key is not configured.'), { status: 401 });
        }

        const model = this.config.model || 'gpt-4o-mini';
        const prompt = this.buildUserPrompt(diff);
        const systemPrompt = this.buildSystemPrompt();

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 1024,
            }),
        });

        console.log('[Kung Commit] HTTP status:', response.status, response.statusText);

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`OpenAI API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();
        console.log('[Kung Commit] Raw API response:', JSON.stringify(data).substring(0, 1000));

        const message = this.parseOpenAIResponse(data);
        if (!message) {
            const reasoning = (data as any).choices?.[0]?.message?.reasoning_content;
            if (reasoning) {
                console.warn('[Kung Commit] content was empty; falling back to reasoning_content');
                // The reasoning may contain the commit message mixed with CoT —
                // sanitizeCommitMessage will extract the conventional-commit line.
                return reasoning.trim();
            }
            console.error('[Kung Commit] Parsed empty message. Raw response:', JSON.stringify(data).substring(0, 1000));
            throw new Error('The AI provider returned an empty message. The API response format may have changed. Check the "Kung Commit" output channel for raw response details.');
        }
        return message;
    }

    protected async doGeneratePR(diff: string, baseBranch?: string, headBranch?: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw Object.assign(new Error('OpenAI API key is not configured.'), { status: 401 });
        }

        const model = this.config.model || 'gpt-4o-mini';
        const prompt = this.buildPRUserPrompt(diff, baseBranch, headBranch);
        const systemPrompt = this.buildPRSystemPrompt();

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 1000,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`OpenAI API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();
        return this.parseOpenAIResponse(data);
    }
}

// ---------------------------------------------------------------------------
// DeepSeek Provider (OpenAI-compatible API)
// ---------------------------------------------------------------------------

export class DeepSeekProvider extends BaseProvider implements AIProvider {
    protected async doGenerate(diff: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw Object.assign(new Error('DeepSeek API key is not configured.'), { status: 401 });
        }

        const model = this.config.model || 'deepseek-chat';
        const prompt = this.buildUserPrompt(diff);
        const systemPrompt = this.buildSystemPrompt();

        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 1024,
            }),
        });

        console.log('[Kung Commit] HTTP status:', response.status, response.statusText);

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`DeepSeek API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();
        console.log('[Kung Commit] Raw API response:', JSON.stringify(data).substring(0, 1000));

        const message = this.parseOpenAIResponse(data);
        if (!message) {
            const reasoning = (data as any).choices?.[0]?.message?.reasoning_content;
            if (reasoning) {
                console.warn('[Kung Commit] content was empty; falling back to reasoning_content');
                // The reasoning may contain the commit message mixed with CoT —
                // sanitizeCommitMessage will extract the conventional-commit line.
                return reasoning.trim();
            }
            console.error('[Kung Commit] Parsed empty message. Raw response:', JSON.stringify(data).substring(0, 1000));
            throw new Error('The AI provider returned an empty message. The API response format may have changed. Check the "Kung Commit" output channel for raw response details.');
        }
        return message;
    }

    protected async doGeneratePR(diff: string, baseBranch?: string, headBranch?: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw Object.assign(new Error('DeepSeek API key is not configured.'), { status: 401 });
        }

        const model = this.config.model || 'deepseek-chat';
        const prompt = this.buildPRUserPrompt(diff, baseBranch, headBranch);
        const systemPrompt = this.buildPRSystemPrompt();

        const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 1000,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`DeepSeek API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();
        return this.parseOpenAIResponse(data);
    }
}

// ---------------------------------------------------------------------------
// Anthropic Provider
// ---------------------------------------------------------------------------

export class AnthropicProvider extends BaseProvider implements AIProvider {
    protected async doGenerate(diff: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw Object.assign(new Error('Anthropic API key is not configured.'), { status: 401 });
        }

        const model = this.config.model || 'claude-sonnet-4-20250514';
        const prompt = this.buildUserPrompt(diff);
        const systemPrompt = this.buildSystemPrompt();

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: 300,
                system: systemPrompt,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        console.log('[Kung Commit] HTTP status:', response.status, response.statusText);

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`Anthropic API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();
        console.log('[Kung Commit] Raw API response:', JSON.stringify(data).substring(0, 1000));

        const message = this.parseAnthropicResponse(data);
        if (!message) {
            console.error('[Kung Commit] Parsed empty message. Raw response:', JSON.stringify(data).substring(0, 1000));
            throw new Error('The AI provider returned an empty message. The API response format may have changed. Check the "Kung Commit" output channel for raw response details.');
        }
        return message;
    }

    protected async doGeneratePR(diff: string, baseBranch?: string, headBranch?: string): Promise<string> {
        const apiKey = this.getApiKey();
        if (!apiKey) {
            throw Object.assign(new Error('Anthropic API key is not configured.'), { status: 401 });
        }

        const model = this.config.model || 'claude-sonnet-4-20250514';
        const prompt = this.buildPRUserPrompt(diff, baseBranch, headBranch);
        const systemPrompt = this.buildPRSystemPrompt();

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: 1000,
                system: systemPrompt,
                messages: [{ role: 'user', content: prompt }],
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`Anthropic API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();
        return this.parseAnthropicResponse(data);
    }
}

// ---------------------------------------------------------------------------
// Custom Provider (generic OpenAI-compatible endpoint)
// ---------------------------------------------------------------------------

export class CustomProvider extends BaseProvider implements AIProvider {
    protected async doGenerate(diff: string): Promise<string> {
        const endpoint = this.config.customEndpoint;
        if (!endpoint) {
            throw new Error(
                'Custom endpoint is not configured. Set kungCommit.customEndpoint in settings.',
            );
        }

        const apiKey = this.getApiKey();
        const model = this.config.customModel || this.config.model || 'gpt-4o-mini';
        const prompt = this.buildUserPrompt(diff);
        const systemPrompt = this.buildSystemPrompt();

        const customHeaders = this.config.customHeaders || {};

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...customHeaders,
        };

        // Only add default Authorization if not already provided via customHeaders
        // Use a case-insensitive check to prevent duplicate Authorization headers.
        const hasAuthHeader = Object.keys(customHeaders).some(
            key => key.toLowerCase() === 'authorization'
        );
        if (!hasAuthHeader && apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 1024,
            }),
        });

        console.log('[Kung Commit] HTTP status:', response.status, response.statusText);

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`Custom API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();
        console.log('[Kung Commit] Raw API response:', JSON.stringify(data).substring(0, 1000));

        // Try OpenAI-like response first, then Anthropic-like fallback
        const message =
            this.parseOpenAIResponse(data) || this.parseAnthropicResponse(data) || '';

        if (!message) {
            const reasoning = (data as any).choices?.[0]?.message?.reasoning_content;
            if (reasoning) {
                console.warn('[Kung Commit] content was empty; falling back to reasoning_content');
                // The reasoning may contain the commit message mixed with CoT —
                // sanitizeCommitMessage will extract the conventional-commit line.
                return reasoning.trim();
            }
            console.error('[Kung Commit] Parsed empty message. Raw response:', JSON.stringify(data).substring(0, 1000));
            throw new Error(
                'Could not parse response from custom endpoint. Expected OpenAI or Anthropic format.',
            );
        }

        return message;
    }

    protected async doGeneratePR(diff: string, baseBranch?: string, headBranch?: string): Promise<string> {
        const endpoint = this.config.customEndpoint;
        if (!endpoint) {
            throw new Error(
                'Custom endpoint is not configured. Set kungCommit.customEndpoint in settings.',
            );
        }

        const apiKey = this.getApiKey();
        const model = this.config.customModel || this.config.model || 'gpt-4o-mini';
        const prompt = this.buildPRUserPrompt(diff, baseBranch, headBranch);
        const systemPrompt = this.buildPRSystemPrompt();

        const customHeaders = this.config.customHeaders || {};

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...customHeaders,
        };

        // Only add default Authorization if not already provided via customHeaders
        const hasAuthHeader = Object.keys(customHeaders).some(
            key => key.toLowerCase() === 'authorization'
        );
        if (!hasAuthHeader && apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.3,
                max_tokens: 1000,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            const err = new Error(`Custom API error (${response.status}): ${errorBody}`);
            (err as any).status = response.status;
            throw err;
        }

        const data = await response.json();

        // Try OpenAI-like response first, then Anthropic-like fallback
        const message =
            this.parseOpenAIResponse(data) || this.parseAnthropicResponse(data) || '';

        if (!message) {
            throw new Error(
                'Could not parse response from custom endpoint. Expected OpenAI or Anthropic format.',
            );
        }

        return message;
    }
}

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

export function createProvider(config: Config): AIProvider {
    switch (config.provider) {
        case 'openai':
            return new OpenAIProvider(config);
        case 'anthropic':
            return new AnthropicProvider(config);
        case 'deepseek':
            return new DeepSeekProvider(config);
        case 'custom':
            return new CustomProvider(config);
        default:
            throw new Error(`Unknown AI provider: ${config.provider}`);
    }
}
