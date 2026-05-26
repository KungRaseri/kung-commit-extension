import * as vscode from 'vscode';

/**
 * Minimal type declarations for the built-in vscode.git extension API.
 * Only declares the subset of the API that AI Commit uses.
 */

export interface Branch {
    /** Branch name (e.g., "main", "feature/add-pr") */
    name: string;
    /** SHA of the branch tip commit */
    commit: string;
    /** GitBranchType enum: 0=HEAD, 1=Remote, 2=Local */
    type: number;
}

export interface RepositoryState {
    /** Current HEAD branch (undefined if detached HEAD) */
    HEAD: Branch | undefined;
    /** All refs in the repository */
    refs: Branch[];
    /** Upstream tracking branch, if any */
    upstream: Branch | undefined;
}

export interface Repository {
    /** Get diff output. true = staged, false = unstaged. */
    diff(staged: boolean): Promise<string>;
    /** The root URI of the repository. */
    rootUri: vscode.Uri;
    /** The SCM input box for commit messages. */
    inputBox: vscode.SourceControlInputBox;
    /** Repository state including current branch and refs. */
    state: RepositoryState;
    /** Get diff between two arbitrary refs (branches, tags, commits). */
    diffBetween(base: string, head: string): Promise<string>;
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
