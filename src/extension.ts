import * as vscode from 'vscode';
import { getConfig } from './config';
import { getDiff } from './gitDiff';
import { createProvider } from './aiProvider';
import { showGenerating, hideStatus, disposeStatusBar } from './statusBar';
import { registerCommitLens } from './commitLens';
import { GitExtension } from './gitExtensionTypes';

// ---------------------------------------------------------------------------
// Command Handler
// ---------------------------------------------------------------------------

async function handleGenerateCommitMessage(): Promise<void> {
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
    showGenerating();

    try {
        // 1. Extract diff from the Git repository
        const diff = await getDiff();

        // 2. Create the AI provider and generate a commit message
        const provider = createProvider(config);
        const message = await provider.generateCommitMessage(diff);

        if (!message) {
            vscode.window.showErrorMessage(
                'Kung Commit: The AI provider returned an empty message.',
            );
            return;
        }

        // 3. Inject the generated message into the SCM input box
        await setScmInputBoxValue(message, config.autoPreview);
    } catch (error: any) {
        const msg = error.message || 'Unknown error';

        // Show non-error notifications for expected scenarios
        if (msg.includes('No changes detected')) {
            vscode.window.showInformationMessage(
                'Kung Commit: No changes detected. Stage or modify files first.',
            );
        } else if (msg.includes('No Git repository found')) {
            vscode.window.showErrorMessage(
                'Kung Commit: No Git repository found in the current workspace.',
            );
        } else if (msg.includes('API key is not configured')) {
            vscode.window.showErrorMessage(
                'Kung Commit: API key is not configured. Check your settings.',
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
// SCM Input Box Integration
// ---------------------------------------------------------------------------

async function setScmInputBoxValue(
    message: string,
    autoPreview: boolean,
): Promise<void> {
    const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!gitExt) {
        throw new Error('Git extension not found.');
    }

    if (!gitExt.isActive) {
        await gitExt.activate();
    }

    const api = gitExt.exports.getAPI(1);
    const repository = api.repositories[0];

    if (!repository) {
        throw new Error('No Git repository found.');
    }

    if (autoPreview) {
        // Show an input box with the generated message for the user to edit/confirm
        const result = await vscode.window.showInputBox({
            value: message,
            prompt: 'Edit or confirm the AI-generated commit message',
            placeHolder: 'Commit message',
            ignoreFocusOut: true,
            valueSelection: [0, message.length],
            validateInput: (input) => {
                return input.trim().length === 0 ? 'Commit message cannot be empty.' : null;
            },
        });

        if (result !== undefined) {
            repository.inputBox.value = result;
            repository.inputBox.valueSelection = [result.length, result.length]; // Place cursor at end
        }
        // If the user cancelled (result === undefined), do nothing
    } else {
        repository.inputBox.value = message;
        repository.inputBox.valueSelection = [0, message.length]; // Select all for easy replacement
    }
}

// ---------------------------------------------------------------------------
// Extension Activation & Deactivation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
    console.log('Kung Commit extension activating...');

    // 1. Register the main command
    const commandDisposable = vscode.commands.registerCommand(
        'kungCommit.generateMessage',
        handleGenerateCommitMessage,
    );
    context.subscriptions.push(commandDisposable);

    // 2. Register CodeLens provider if enabled
    const config = getConfig();
    if (config.showCodeLens) {
        const codeLensDisposable = registerCommitLens();
        context.subscriptions.push(codeLensDisposable);
    }

    // 3. Listen for configuration changes and re-register CodeLens if needed
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('kungCommit.showCodeLens')) {
                const newConfig = getConfig();
                // Note: Full dynamic re-registration would require tracking
                // the disposable, which adds complexity. For v1 we simply log
                // the change; the user can reload the window to pick up changes.
                console.log(
                    `Kung Commit: showCodeLens changed to ${newConfig.showCodeLens}. Reload window to apply.`,
                );
            }
        }),
    );

    // 4. Clean up status bar on deactivation
    context.subscriptions.push({ dispose: disposeStatusBar });

    console.log('Kung Commit extension activated successfully.');
}

export function deactivate(): void {
    disposeStatusBar();
}
