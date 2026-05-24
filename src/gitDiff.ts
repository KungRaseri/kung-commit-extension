import * as vscode from 'vscode';
import { GitExtension } from './gitExtensionTypes';

/**
 * Extract the git diff from the current workspace repository.
 * Prefers staged changes, falls back to unstaged changes.
 * Returns the diff content as a string.
 */
export async function getDiff(): Promise<string> {
    const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExt) {
        throw new Error('Git extension not found. Please make sure the built-in Git extension is enabled.');
    }

    if (!gitExt.isActive) {
        await gitExt.activate();
    }

    const api = gitExt.exports.getAPI(1);
    const repository = api.repositories[0];

    if (!repository) {
        throw new Error('No Git repository found in the current workspace.');
    }

    const config = vscode.workspace.getConfiguration('kungCommit');
    const maxDiffChars = config.get<number>('maxDiffChars', 4000);

    // Try staged diff first
    let diff = await repository.diff(true);
    if (diff.trim().length === 0) {
        // Fall back to unstaged diff
        diff = await repository.diff(false);
    }

    if (diff.trim().length === 0) {
        throw new Error('No changes detected in the repository. Stage or modify files first.');
    }

    // Truncate if the diff exceeds the maximum allowed characters
    if (diff.length > maxDiffChars) {
        diff = diff.substring(0, maxDiffChars) + '\n\n-- Diff truncated --';
    }

    return diff;
}
