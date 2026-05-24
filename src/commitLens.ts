import * as vscode from 'vscode';

/**
 * Register a CodeLens provider that shows "✨ Generate Commit Message"
 * on the first line of any git diff document.
 *
 * When clicked, it executes the `kungCommit.generateMessage` command.
 */
export function registerCommitLens(): vscode.Disposable {
    const provider = new KungCommitCodeLensProvider();

    // Target documents with the 'git' scheme (VS Code's built-in Git extension)
    const selector: vscode.DocumentSelector = { scheme: 'git' };

    return vscode.languages.registerCodeLensProvider(selector, provider);
}

class KungCommitCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        // Only show the CodeLens on the first line of the document
        if (document.lineCount === 0) {
            return [];
        }

        const firstLine = document.lineAt(0);
        const range = new vscode.Range(0, 0, 0, firstLine.text.length);

        const codeLens = new vscode.CodeLens(range, {
            title: '\u2728 Generate Commit Message',
            tooltip: 'Generate a conventional commit message using AI',
            command: 'kungCommit.generateMessage',
            arguments: [],
        });

        return [codeLens];
    }
}
