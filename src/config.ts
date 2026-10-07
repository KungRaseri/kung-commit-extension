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
 * Default prompt templates.
 *
 * These only supply the task context and the diff. The output-format rules
 * live in the provider system prompts (see `buildSystemPrompt` and
 * `buildPRSystemPrompt` in aiProvider.ts) so that they cannot be weakened
 * by editing a user-facing template.
 *
 * NOTE: Keep these strings in sync with the matching defaults in package.json
 * (`kungCommit.promptTemplate`, `kungCommit.prPromptTemplate`).
 */

/** Supports the {{diff}} placeholder. */
const DEFAULT_COMMIT_PROMPT_TEMPLATE = [
    'Generate a commit message for the diff below.',
    '',
    '{{diff}}',
].join('\n');

/** Supports {{diff}}, {{baseBranch}}, {{headBranch}} placeholders. */
const DEFAULT_PR_PROMPT_TEMPLATE = [
    'Write a pull request title and description for the changes below.',
    '',
    'Include these sections in the description:',
    '- ## Summary \u2014 brief overview of what this PR does',
    '- ## Changes \u2014 bullet list of key technical changes',
    '- ## Breaking Changes \u2014 describe any, or "None"',
    '- ## Related Issues \u2014 reference any, or "None"',
    '',
    'Be concise but thorough. Focus on the WHAT and WHY.',
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
        promptTemplate: cfg.get<string>('promptTemplate', DEFAULT_COMMIT_PROMPT_TEMPLATE),
        maxDiffChars: cfg.get<number>('maxDiffChars', 4000),
        locale: cfg.get<string>('locale', 'en'),
        autoPreview: cfg.get<boolean>('autoPreview', true),
        showCodeLens: cfg.get<boolean>('showCodeLens', true),
        prPromptTemplate: cfg.get<string>('prPromptTemplate', DEFAULT_PR_PROMPT_TEMPLATE),
        autoOpenPRView: cfg.get<boolean>('autoOpenPRView', false),
    };
}
