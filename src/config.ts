import * as vscode from 'vscode';

export interface Config {
    provider: 'openai' | 'anthropic' | 'deepseek' | 'custom';
    apiKey: string;
    model: string;
    customEndpoint: string;
    customModel: string;
    customHeaders: Record<string, string>;
    promptTemplate: string;
    maxDiffChars: number;
    locale: string;
    autoPreview: boolean;
    showCodeLens: boolean;
    // PR description generation
    prPromptTemplate: string;
    autoOpenPRView: boolean;
}

/**
 * Default prompt template for PR title & description generation.
 * Supports {{diff}}, {{baseBranch}}, {{headBranch}} placeholders.
 */
const DEFAULT_PR_PROMPT_TEMPLATE = [
    'Generate a pull request title and description for the code changes below.',
    '',
    'Rules:',
    '1. The FIRST LINE must be the PR title only (max 72 characters).',
    '2. After a blank line, provide the PR description body using Markdown.',
    '3. Include these sections in the description:',
    '   - ## Summary \u2014 brief overview of what this PR does',
    '   - ## Changes \u2014 bullet list of key technical changes',
    '   - ## Breaking Changes \u2014 note if any, or "None"',
    '   - ## Related Issues \u2014 reference any related issues',
    '4. Be concise but thorough. Focus on the WHAT and WHY.',
    '5. Use present tense, imperative mood.',
    '',
    'Branch: {{baseBranch}} -> {{headBranch}}',
    '',
    'Changes:',
    '{{diff}}',
].join('\n');

export function getConfig(): Config {
    const cfg = vscode.workspace.getConfiguration('kungCommit');
    return {
        provider: cfg.get<'openai' | 'anthropic' | 'deepseek' | 'custom'>('provider', 'deepseek'),
        apiKey: cfg.get<string>('apiKey', '') || process.env.KUNG_COMMIT_API_KEY || '',
        model: cfg.get<string>('model', 'deepseek-chat'),
        customEndpoint: cfg.get<string>('customEndpoint', ''),
        customModel: cfg.get<string>('customModel', ''),
        customHeaders: cfg.get<Record<string, string>>('customHeaders', {}),
        promptTemplate: cfg.get<string>('promptTemplate', 'Generate a concise conventional commit message for these changes:\n\n{{diff}}'),
        maxDiffChars: cfg.get<number>('maxDiffChars', 4000),
        locale: cfg.get<string>('locale', 'en'),
        autoPreview: cfg.get<boolean>('autoPreview', true),
        showCodeLens: cfg.get<boolean>('showCodeLens', true),
        prPromptTemplate: cfg.get<string>('prPromptTemplate', DEFAULT_PR_PROMPT_TEMPLATE),
        autoOpenPRView: cfg.get<boolean>('autoOpenPRView', false),
    };
}
