import * as vscode from 'vscode';

export interface Config {
    provider: 'openai' | 'anthropic' | 'custom';
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
}

export function getConfig(): Config {
    const cfg = vscode.workspace.getConfiguration('kungCommit');
    return {
        provider: cfg.get<'openai' | 'anthropic' | 'custom'>('provider', 'openai'),
        apiKey: cfg.get<string>('apiKey', '') || process.env.KUNG_COMMIT_API_KEY || '',
        model: cfg.get<string>('model', 'gpt-4o-mini'),
        customEndpoint: cfg.get<string>('customEndpoint', ''),
        customModel: cfg.get<string>('customModel', ''),
        customHeaders: cfg.get<Record<string, string>>('customHeaders', {}),
        promptTemplate: cfg.get<string>('promptTemplate', 'Generate a concise conventional commit message for these changes:\n\n{{diff}}'),
        maxDiffChars: cfg.get<number>('maxDiffChars', 4000),
        locale: cfg.get<string>('locale', 'en'),
        autoPreview: cfg.get<boolean>('autoPreview', true),
        showCodeLens: cfg.get<boolean>('showCodeLens', true),
    };
}
