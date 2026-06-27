import * as vscode from 'vscode';
import { GitExtension, Repository } from './gitExtensionTypes';
import { exec } from 'child_process';
import { promisify } from 'util';

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

/**
 * Check whether changes exist in the repository by inspecting the
 * repository state properties (more reliable than relying solely on
 * `diff()` output, which can be affected by stale internal state).
 */
function hasChanges(repository: Repository): boolean {
    return (
        repository.state.workingTreeChanges.length > 0 ||
        repository.state.indexChanges.length > 0 ||
        repository.state.mergeChanges.length > 0 ||
        repository.state.untrackedChanges.length > 0
    );
}

/**
 * Force-refresh the repository state by calling `status()`.
 * This ensures the git extension's internal model is in sync
 * with the actual file system and git index before we attempt
 * to retrieve diffs.
 */
async function refreshRepository(repository: Repository): Promise<void> {
    try {
        await repository.status();
    } catch {
        // status() may throw if the repository is in a bad state;
        // we gracefully continue without refresh.
    }
}

/**
 * Attempt to retrieve a diff, with optional retry after refreshing
 * the repository state. Returns the diff string, or `undefined` if
 * no diff could be obtained.
 */
async function tryGetDiff(
    repository: Repository,
    staged: boolean,
    attempt: number = 1,
): Promise<string | undefined> {
    for (let i = 0; i < attempt; i++) {
        if (i > 0) {
            // On retry, refresh the repository state first
            await refreshRepository(repository);
        }

        try {
            const diff = await repository.diff(staged);
            if (diff.trim().length > 0) {
                return diff;
            }
        } catch {
            // diff() may throw if the repository state is inconsistent;
            // continue to retry if we have attempts left.
        }
    }

    return undefined;
}

/**
 * Build a combined diff header that describes which sections are staged
 * vs. unstaged, making it clear to the AI what is already in the index
 * and what is still in the working tree.
 */
function buildCombinedDiff(stagedDiff: string, unstagedDiff: string): string {
    const parts: string[] = [];

    if (stagedDiff) {
        parts.push('=== STAGED CHANGES (index) ===\n' + stagedDiff.trim());
    }

    if (unstagedDiff) {
        parts.push('=== UNSTAGED CHANGES (working tree) ===\n' + unstagedDiff.trim());
    }

    return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Fallback: direct `git diff` via terminal
// ---------------------------------------------------------------------------

/**
 * Execute a git command directly in the repository root using the shell.
 * This serves as a last-resort fallback when the VS Code Git extension API
 * fails to return changes that we know exist.
 */
async function fallbackGitDiff(repository: Repository, staged: boolean): Promise<string> {
    const cwd = repository.rootUri.fsPath;
    const args = staged
        ? ['diff', '--cached', '--no-color']
        : ['diff', '--no-color'];

    try {
        const { stdout, stderr } = await executeGitCommand(cwd, args);

        if (stderr && stderr.trim()) {
            console.warn(`Kung Commit: fallback git diff stderr: ${stderr}`);
        }

        return stdout || '';
    } catch (error: any) {
        console.warn(`Kung Commit: fallback git diff failed: ${error.message || error}`);
        return '';
    }
}

/**
 * Run `git status --porcelain` as an ultimate fallback to detect changes
 * that `git diff` cannot see (e.g., untracked/new files).
 *
 * Because untracked files have no diff content, we build a structured
 * summary describing what was added.
 *
 * Returns a human-readable diff-like string, or an empty string if the
 * status shows no changes.
 */
async function fallbackGitStatus(repository: Repository): Promise<string> {
    const cwd = repository.rootUri.fsPath;

    try {
        const { stdout } = await executeGitCommand(cwd, ['status', '--porcelain']);

        if (!stdout || !stdout.trim()) {
            return '';
        }

        const lines = stdout.trim().split('\n');
        const staged: string[] = [];
        const unstaged: string[] = [];
        const untracked: string[] = [];
        const conflicted: string[] = [];

        for (const line of lines) {
            const xy = line.substring(0, 2).trim();
            const file = line.substring(3).trim();

            if (line.startsWith('??')) {
                untracked.push(file);
            } else if (xy.includes('U') || xy === 'DD' || xy === 'AA') {
                conflicted.push(`${xy} ${file}`);
            } else if (line[0] !== ' ' && line[0] !== '?') {
                // First character non-blank → staged
                staged.push(`${line[0]} ${file}`);
            } else if (line[1] !== ' ' && line[1] !== '?') {
                // Second character non-blank → unstaged
                unstaged.push(`${line[1]} ${file}`);
            }
        }

        const parts: string[] = [];

        if (staged.length > 0) {
            parts.push('=== STAGED CHANGES (index) ===\n' + staged.join('\n'));
        }
        if (unstaged.length > 0) {
            parts.push('=== UNSTAGED CHANGES (working tree) ===\n' + unstaged.join('\n'));
        }
        if (untracked.length > 0) {
            parts.push('=== UNTRACKED FILES ===\n' + untracked.map(f => `A ${f}`).join('\n'));
        }
        if (conflicted.length > 0) {
            parts.push('=== CONFLICTED FILES ===\n' + conflicted.join('\n'));
        }

        // Prepend a note explaining this came from `git status` rather than
        // a real diff, so the AI knows it's a list of files, not a patch.
        const header =
            'NOTE: This is a file-status summary (not a full patch) because ' +
            'the changes include untracked files or the diff could not be retrieved.\n\n';

        return header + parts.join('\n\n');
    } catch (error: any) {
        console.warn(`Kung Commit: fallback git status failed: ${error.message || error}`);
        return '';
    }
}

const execAsync = promisify(exec);

/**
 * Run a raw git command and return its output.
 */
async function executeGitCommand(
    cwd: string,
    args: string[],
): Promise<{ stdout: string; stderr: string }> {
    const command = `git ${args.join(' ')}`;

    try {
        const { stdout, stderr } = await execAsync(command, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        return { stdout, stderr };
    } catch (error: any) {
        // exec throws on non-zero exit; the diff may still be in stdout
        return {
            stdout: error.stdout || '',
            stderr: error.stderr || error.message || '',
        };
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the git diff from the current workspace repository.
 *
 * Detection strategy (in order):
 * 1. Check `repository.state` properties to see if changes exist at all.
 * 2. If the state indicates changes but `diff()` returns empty, refresh the
 *    repository via `status()` and retry.
 * 3. Combine staged AND unstaged diffs when both contain content, so the AI
 *    has the full picture.
 * 4. If the API still comes up empty despite the state showing changes, fall
 *    back to running `git diff` directly via the shell.
 *
 * Returns the diff content as a string.
 */
export async function getDiff(): Promise<string> {
    const repository = await getRepository();

    // --- Ensure repository state is fresh ---
    // This is critical: the state arrays (workingTreeChanges, indexChanges, etc.)
    // may not be populated immediately on activation. A status() refresh forces
    // the Git extension to re-index the working tree and index.
    await refreshRepository(repository);

    // --- Attempt to retrieve diffs ---
    const maxDiffChars = getMaxDiffChars();

    // Try staged diff (with retry + refresh on retry)
    let stagedDiff = await tryGetDiff(repository, true, 2);

    // Try unstaged diff (with retry + refresh on retry)
    let unstagedDiff = await tryGetDiff(repository, false, 2);

    // --- Fallback: use hasChanges() to decide if we should try harder ---
    // If both API diffs came back empty but the repository state (after refresh)
    // says there ARE changes, the Git extension API's diff() may be stale.
    // Fall back to direct `git diff` via shell.
    const stateShowsChanges = hasChanges(repository);

    if (!stagedDiff && !unstagedDiff) {
        if (stateShowsChanges) {
            console.warn(
                'Kung Commit: Git extension API returned empty diffs despite ' +
                'state indicating changes. Falling back to direct `git diff`.',
            );
        }

        stagedDiff = await fallbackGitDiff(repository, true);
        unstagedDiff = await fallbackGitDiff(repository, false);
    }

    // --- Ultimate fallback: git status --porcelain ---
    // This catches scenarios where changes exist but produce no diff output,
    // most commonly untracked (new) files that haven't been staged yet.
    // `git diff` cannot show untracked files - only `git status` can detect them.
    if (!stagedDiff && !unstagedDiff) {
        console.warn(
            'Kung Commit: `git diff` also returned empty. Trying `git status --porcelain` ' +
            'as an ultimate fallback for untracked/new files.',
        );

        const statusOutput = await fallbackGitStatus(repository);
        if (statusOutput) {
            return truncateDiff(statusOutput, maxDiffChars);
        }
    }

    // --- Build the final diff ---
    let diff: string;

    if (stagedDiff && unstagedDiff) {
        // Both staged and unstaged changes exist: combine them
        diff = buildCombinedDiff(stagedDiff, unstagedDiff);
    } else if (stagedDiff) {
        diff = stagedDiff;
    } else if (unstagedDiff) {
        diff = unstagedDiff;
    } else {
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
