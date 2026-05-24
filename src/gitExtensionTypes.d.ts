import * as vscode from 'vscode';

/**
 * Minimal type declarations for the built-in vscode.git extension API.
 * Only declares the subset of the API that AI Commit uses.
 */
export interface Repository {
    /** Get diff output. true = staged, false = unstaged. */
    diff(staged: boolean): Promise<string>;
    /** The root URI of the repository. */
    rootUri: vscode.Uri;
    /** The SCM input box for commit messages. */
    inputBox: vscode.SourceControlInputBox;
}

export interface GitAPI {
    /** All open repositories. */
    repositories: Repository[];
    /** Get a repository for a given URI. */
    getRepository(uri: vscode.Uri): Repository | undefined;
}

export interface GitExtension {
    /** Get the Git API for a given version. */
    getAPI(version: number): GitAPI;
}
