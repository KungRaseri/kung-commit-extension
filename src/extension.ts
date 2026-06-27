import * as vscode from 'vscode';
import { getConfig } from './config';
import { getDiff, getBranchDiff, getRepository as getGitRepository } from './gitDiff';
import { createProvider } from './aiProvider';
import { showGenerating, showPRGenerating, hideStatus, disposeStatusBar } from './statusBar';
import { registerCommitLens } from './commitLens';

// ---------------------------------------------------------------------------
// Command Handler: Generate Commit Message
// ---------------------------------------------------------------------------

async function handleGenerateCommitMessage(): Promise<void> {
    console.log('Kung Commit: handleGenerateCommitMessage started');
    const config = getConfig();
    console.log('Kung Commit: provider =', config.provider, 'model =', config.model);

    // Validate API key
    const apiKey = config.apiKey || '';
    if (!apiKey) {
        console.warn('Kung Commit: API key not configured');
        const selection = await vscode.window.showErrorMessage(
            'Kung Commit: API key not configured. Set the "kungCommit.apiKey" setting or the KUNG_COMMIT_API_KEY environment variable.',
            'Open Settings',
        );
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'kungCommit.apiKey',
            );
        }
        return;
    }
    console.log('Kung Commit: API key present');

    // Show progress in the status bar
    showGenerating();

    try {
        // 1. Extract diff from the Git repository
        console.log('Kung Commit: calling getDiff()...');
        const diff = await getDiff();
        console.log(`Kung Commit: getDiff() returned ${diff.length} chars`);

        // 2. Create the AI provider and generate a commit message
        console.log('Kung Commit: creating provider...');
        const provider = createProvider(config);
        console.log('Kung Commit: provider created, calling generateCommitMessage...');
        const message = await provider.generateCommitMessage(diff);
        console.log(`Kung Commit: generateCommitMessage returned ${message ? message.length + ' chars' : 'null'}`);

        if (!message) {
            vscode.window.showErrorMessage(
                'Kung Commit: The AI provider returned an empty message.',
            );
            return;
        }

        // 3. Inject the generated message directly into the SCM input box
        console.log('Kung Commit: getting repository for SCM input box...');
        const repository = await getGitRepository();
        repository.inputBox.value = message;
        console.log('Kung Commit: message injected into SCM input box');
    } catch (error: any) {
        const msg = error.message || 'Unknown error';
        console.error(`Kung Commit: CAUGHT ERROR — name=${error.name}, status=${error.status}, msg="${msg}"`);

        // Show non-error notifications for expected scenarios
        if (msg.includes('No changes detected')) {
            console.warn('Kung Commit: matched "No changes detected" handler');
            vscode.window.showInformationMessage(
                'Kung Commit: No changes detected. Stage or modify files first.',
            );
        } else if (msg.includes('No Git repository found')) {
            console.warn('Kung Commit: matched "No Git repository found" handler');
            vscode.window.showErrorMessage(
                'Kung Commit: No Git repository found in the current workspace.',
            );
        } else if (msg.includes('API key is not configured')) {
            console.warn('Kung Commit: matched "API key is not configured" handler');
            vscode.window.showErrorMessage(
                'Kung Commit: API key is not configured. Check your settings.',
            );
        } else if (error.status === 401 || error.status === 403) {
            console.warn('Kung Commit: matched 401/403 handler');
            vscode.window.showErrorMessage(
                'Kung Commit: Authentication failed. Check your API key.',
            );
        } else if (error.status === 429) {
            console.warn('Kung Commit: matched 429 handler');
            vscode.window.showErrorMessage(
                'Kung Commit: Rate limited. Please wait and try again.',
            );
        } else if (error.status && error.status >= 500) {
            console.warn('Kung Commit: matched 5xx handler');
            vscode.window.showErrorMessage(
                `Kung Commit: AI provider server error (${error.status}). Please try again later.`,
            );
        } else if (
            error.name === 'TypeError' &&
            String(msg).includes('fetch')
        ) {
            console.warn('Kung Commit: matched network error handler');
            vscode.window.showErrorMessage(
                'Kung Commit: Network error. Check your internet connection and API endpoint.',
            );
        } else {
            console.warn(`Kung Commit: no specific handler matched — showing generic error`);
            vscode.window.showErrorMessage(`Kung Commit: ${msg}`);
        }
    } finally {
        console.log('Kung Commit: handleGenerateCommitMessage finished (finally block)');
        hideStatus();
    }
}

// ---------------------------------------------------------------------------
// Command Handler: Generate PR Description
// ---------------------------------------------------------------------------

/**
 * Parse the AI response into PR title and description.
 * First line is the title, everything after is the description body.
 */
function parsePRResult(raw: string): { title: string; description: string } {
    const trimmed = raw.trim();
    const firstNewline = trimmed.indexOf('\n');

    if (firstNewline === -1) {
        return { title: trimmed, description: '' };
    }

    return {
        title: trimmed.substring(0, firstNewline).trim(),
        description: trimmed.substring(firstNewline + 1).trim(),
    };
}

async function handleGeneratePRDescription(): Promise<void> {
    const config = getConfig();

    // Validate API key
    const apiKey = config.apiKey || '';
    if (!apiKey) {
        const selection = await vscode.window.showErrorMessage(
            'Kung Commit: API key not configured. Set the "kungCommit.apiKey" setting or the KUNG_COMMIT_API_KEY environment variable.',
            'Open Settings',
        );
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'kungCommit.apiKey',
            );
        }
        return;
    }

    // Show progress in the status bar
    showPRGenerating();

    try {
        // 1. Detect base branch and get branch diff
        const { diff, baseBranch, headBranch } = await getBranchDiff();

        // 2. Create the AI provider and generate PR description
        const provider = createProvider(config);
        const result = await provider.generatePRDescription(diff, baseBranch, headBranch);

        if (!result) {
            vscode.window.showErrorMessage(
                'Kung Commit: The AI provider returned an empty PR description.',
            );
            return;
        }

        // 3. Parse result into title and description
        const { title, description } = parsePRResult(result);

        // 4. Format for clipboard
        const prText = `${title}\n\n${description}`.trim();

        // 5. Copy to clipboard
        await vscode.env.clipboard.writeText(prText);

        // 6. Show success notification with optional "Open PR View" action
        const action = await vscode.window.showInformationMessage(
            `Kung Commit: PR description copied to clipboard!`,
            ...(config.autoOpenPRView ? [] : ['Open PR View']),
        );

        if (action === 'Open PR View') {
            vscode.commands.executeCommand('pr:create');
        } else if (config.autoOpenPRView) {
            vscode.commands.executeCommand('pr:create');
        }
    } catch (error: any) {
        const msg = error.message || 'Unknown error';

        if (msg.includes('No Git repository found')) {
            vscode.window.showErrorMessage(
                'Kung Commit: No Git repository found in the current workspace.',
            );
        } else if (msg.includes('API key is not configured')) {
            vscode.window.showErrorMessage(
                'Kung Commit: API key is not configured. Check your settings.',
            );
        } else if (msg.includes('Could not determine the base branch')) {
            vscode.window.showErrorMessage(
                'Kung Commit: Could not determine the base branch. Make sure you are on a feature branch with a main/master branch.',
            );
        } else if (msg.includes('No differences found')) {
            vscode.window.showInformationMessage(
                `Kung Commit: No differences found between the base branch and current branch.`,
            );
        } else if (error.status === 401 || error.status === 403) {
            vscode.window.showErrorMessage(
                'Kung Commit: Authentication failed. Check your API key.',
            );
        } else if (error.status === 429) {
            vscode.window.showErrorMessage(
                'Kung Commit: Rate limited. Please wait and try again.',
            );
        } else if (error.status && error.status >= 500) {
            vscode.window.showErrorMessage(
                `Kung Commit: AI provider server error (${error.status}). Please try again later.`,
            );
        } else if (
            error.name === 'TypeError' &&
            String(msg).includes('fetch')
        ) {
            vscode.window.showErrorMessage(
                'Kung Commit: Network error. Check your internet connection and API endpoint.',
            );
        } else {
            vscode.window.showErrorMessage(`Kung Commit: ${msg}`);
        }
    } finally {
        hideStatus();
    }
}

// ---------------------------------------------------------------------------
// Extension Activation & Deactivation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
    console.log('Kung Commit extension activating...');

    // 1. Register the commit message generation command
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'kungCommit.generateMessage',
            handleGenerateCommitMessage,
        ),
    );

    // 2. Register the PR description generation command
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'kungCommit.generatePRDescription',
            handleGeneratePRDescription,
        ),
    );

    // 3. Register CodeLens provider if enabled
    const config = getConfig();
    if (config.showCodeLens) {
        const codeLensDisposable = registerCommitLens();
        context.subscriptions.push(codeLensDisposable);
    }

    // 4. Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('kungCommit.showCodeLens')) {
                const newConfig = getConfig();
                console.log(
                    `Kung Commit: showCodeLens changed to ${newConfig.showCodeLens}. Reload window to apply.`,
                );
            }
        }),
    );

    // 5. Clean up status bar on deactivation
    context.subscriptions.push({ dispose: disposeStatusBar });

    console.log('Kung Commit extension activated successfully.');
}

export function deactivate(): void {
    disposeStatusBar();
}
