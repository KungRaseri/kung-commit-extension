import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Show the "Generating" status bar message.
 * Creates the status bar item if it doesn't exist yet.
 */
export function showGenerating(): void {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100,
        );
    }
    statusBarItem.text = '$(sync~spin) Kung Commit: Generating message...';
    statusBarItem.tooltip = 'Generating commit message with AI';
    statusBarItem.show();
}

/**
 * Hide the status bar item.
 */
export function hideStatus(): void {
    if (statusBarItem) {
        statusBarItem.hide();
    }
}

/**
 * Dispose of the status bar item (call during deactivation).
 */
export function disposeStatusBar(): void {
    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = undefined;
    }
}
