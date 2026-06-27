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

export interface GitChange {
    /** The URI of the file that changed */
    uri: vscode.Uri;
    /** Original file URI (for renames) */
    originalUri: vscode.Uri | undefined;
    /** Status string: 'M' modified, 'A' added, 'D' deleted, 'R' renamed, etc. */
    status: string;
}

export interface RepositoryState {
    /** Current HEAD branch (undefined if detached HEAD) */
    HEAD: Branch | undefined;
    /** All refs in the repository */
    refs: Branch[];
    /** Upstream tracking branch, if any */
    upstream: Branch | undefined;
    /** Changes in the working tree (unstaged modifications to tracked files) */
    workingTreeChanges: GitChange[];
    /** Changes staged in the index */
    indexChanges: GitChange[];
    /** Merge changes (conflicted files) */
    mergeChanges: GitChange[];
    /** Untracked files (new files not yet added to the index) */
    untrackedChanges: GitChange[];
}

export interface Repository {
    /** Get diff output. true = staged, false = unstaged. */
    diff(staged: boolean): Promise<string>;
    /** The root URI of the repository. */
    rootUri: vscode.Uri;
    /** The SCM input box for commit messages. */
    inputBox: vscode.SourceControlInputBox;
    /** Repository state including current branch, refs, and tracked changes. */
    state: RepositoryState;
    /** Get diff between two arbitrary refs (branches, tags, commits). */
    diffBetween(base: string, head: string): Promise<string>;
    /** Refresh the repository state (re-index working tree and index). */
    status(): Promise<void>;
}

export interface GitAPI {
    /** All open repositories. */
    repositories: Repository[];
    /** Get a repository for a given URI. */
    getRepository(uri: vscode.Uri): Repository | undefined;
    /** Git executable information. */
    git: GitExecution;
}

/** Information about the Git executable used by the extension. */
export interface GitExecution {
    /** The filesystem path to the Git binary (e.g., "C:\\Program Files\\Git\\bin\\git.exe"). */
    path: string;
    /** The Git version string. */
    version: string;
}

export interface GitExtension {
    /** Get the Git API for a given version. */
    getAPI(version: number): GitAPI;
}
