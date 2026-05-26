import * as vscode from 'vscode';
import { GitExtension, Repository } from './gitExtensionTypes';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Get the active Git repository from the built-in vscode.git extension.
 */
export async function getRepository(): Promise<Repository> {
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

    return repository;
}

/**
 * Read the kungCommit.maxDiffChars setting.
 */
function getMaxDiffChars(): number {
    return vscode.workspace.getConfiguration('kungCommit').get<number>('maxDiffChars', 4000);
}

/**
 * Truncate diff content if it exceeds the maximum allowed characters.
 */
function truncateDiff(diff: string, maxChars: number): string {
    if (diff.length > maxChars) {
        return diff.substring(0, maxChars) + '\n\n-- Diff truncated --';
    }
    return diff;
}

// ---------------------------------------------------------------------------
// Existing: staged/unstaged diff for commit messages
// ---------------------------------------------------------------------------

/**
 * Extract the git diff from the current workspace repository.
 * Prefers staged changes, falls back to unstaged changes.
 * Returns the diff content as a string.
 */
export async function getDiff(): Promise<string> {
    const repository = await getRepository();
    const maxDiffChars = getMaxDiffChars();

    // Try staged diff first
    let diff = await repository.diff(true);
    if (diff.trim().length === 0) {
        // Fall back to unstaged diff
        diff = await repository.diff(false);
    }

    if (diff.trim().length === 0) {
        throw new Error('No changes detected in the repository. Stage or modify files first.');
    }

    return truncateDiff(diff, maxDiffChars);
}

// ---------------------------------------------------------------------------
// NEW: Branch diff for PR description generation
// ---------------------------------------------------------------------------

/**
 * Candidate base branch names to try, in priority order.
 * Uses both local and remote-tracking variants.
 */
const BASE_BRANCH_CANDIDATES = [
    'main',
    'master',
    'origin/main',
    'origin/master',
];

/**
 * Detect the most likely base branch for a PR.
 *
 * Detection priority:
 * 1. Upstream tracking branch of the current HEAD
 * 2. Common branch names: main, master, origin/main, origin/master
 *
 * Each candidate is validated by calling `repository.diffBetween(candidate, 'HEAD')`.
 * The first candidate that resolves without error is used.
 *
 * @throws Error if no base branch can be determined.
 */
export async function detectBaseBranch(repository: Repository): Promise<string> {
    const head = repository.state.HEAD;

    // If we have an upstream tracking branch, try it first
    if (head?.name && repository.state.upstream?.name) {
        const upstream = repository.state.upstream.name;
        // upstream returns e.g. "refs/remotes/origin/main" — extract the short name
        const shortUpstream = upstream.replace(/^refs\/remotes\//, '');
        try {
            const testDiff = await repository.diffBetween(shortUpstream, 'HEAD');
            // If we get here, the ref exists (even if diff is empty)
            if (testDiff !== undefined) {
                return shortUpstream;
            }
        } catch {
            // Ref doesn't exist or can't diff — fall through to candidates
        }
    }

    // Fall back to trying common base branch names
    for (const candidate of BASE_BRANCH_CANDIDATES) {
        try {
            const testDiff = await repository.diffBetween(candidate, 'HEAD');
            if (testDiff !== undefined) {
                return candidate;
            }
        } catch {
            // Candidate doesn't exist — try next
            continue;
        }
    }

    throw new Error(
        'Could not determine the base branch for a PR. ' +
        'Make sure the repository has a main or master branch, ' +
        'or set an upstream tracking branch for the current feature branch.',
    );
}

/**
 * Get the diff between the detected base branch and the current HEAD.
 *
 * @returns An object containing:
 *   - diff:       The diff content (possibly truncated)
 *   - baseBranch: The detected base branch name
 *   - headBranch: The current branch name (or 'HEAD' if detached)
 */
export async function getBranchDiff(): Promise<{
    diff: string;
    baseBranch: string;
    headBranch: string;
}> {
    const repository = await getRepository();
    const maxDiffChars = getMaxDiffChars();

    // Detect base branch
    const baseBranch = await detectBaseBranch(repository);

    // Get current branch name
    const headBranch = repository.state.HEAD?.name || 'HEAD';

    // Get diff between base and HEAD
    let diff: string;
    try {
        diff = await repository.diffBetween(baseBranch, 'HEAD');
    } catch (error: any) {
        throw new Error(
            `Failed to get diff between "${baseBranch}" and "${headBranch}": ${error.message || error}`,
        );
    }

    if (!diff || diff.trim().length === 0) {
        throw new Error(
            `No differences found between "${baseBranch}" and "${headBranch}". ` +
            'Make sure the feature branch has commits ahead of the base branch.',
        );
    }

    return {
        diff: truncateDiff(diff, maxDiffChars),
        baseBranch,
        headBranch,
    };
}
