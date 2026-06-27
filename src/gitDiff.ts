import * as vscode from 'vscode';
import { GitExtension, Repository, GitAPI } from './gitExtensionTypes';
import { exec } from 'child_process';
import { promisify } from 'util';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the "active" Git repository — the one that the user is most likely
 * targeting when they click the "Generate Commit Message" button. This is
 * critical in multi-root workspaces or when VS Code has multiple Git repos
 * open: the user expects the extension to act on the right repo.
 *
 * Resolution strategy (in order):
 *   1. Use `api.getRepository(uri)` with the active editor's document URI.
 *      This works when the user has a file open from one of the repos.
 *   2. Look for repositories that have **staged changes** — the user is
 *      most likely about to commit from a repo that has staged changes.
 *   3. Look for repositories that have **working tree changes** (unstaged).
 *   4. If multiple repos have changes, show a QuickPick so the user can
 *      choose which repo they intended.
 *   5. Fall back to the first repository in the list.
 *
 * @throws Error if no Git extension or no repository is found.
 */
function getActiveRepository(api: GitAPI): Repository {
    // Strategy 1: active editor's document belongs to a repository
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && !activeEditor.document.isUntitled) {
        const docUri = activeEditor.document.uri;
        const repoFromEditor = api.getRepository(docUri);
        if (repoFromEditor) {
            return repoFromEditor;
        }
    }

    // Strategy 2: look for repos with staged changes (most actionable)
    const repos = api.repositories;
    if (repos.length === 0) {
        throw new Error('No Git repository found in the current workspace.');
    }

    if (repos.length === 1) {
        return repos[0];
    }

    // Multiple repos — try to find the best match
    const reposWithStaged = repos.filter(r => r.state.indexChanges.length > 0);
    if (reposWithStaged.length === 1) {
        console.log(`Kung Commit: selected repo with staged changes: ${reposWithStaged[0].rootUri.fsPath}`);
        return reposWithStaged[0];
    }

    // Strategy 3: look for repos with working tree changes
    const reposWithChanges = repos.filter(
        r => r.state.workingTreeChanges.length > 0 || r.state.untrackedChanges.length > 0,
    );
    if (reposWithChanges.length === 1) {
        console.log(`Kung Commit: selected repo with working tree changes: ${reposWithChanges[0].rootUri.fsPath}`);
        return reposWithChanges[0];
    }

    // Strategy 4: multiple repos have changes — prompt user to pick
    if (reposWithStaged.length > 1 || reposWithChanges.length > 1) {
        const candidates = reposWithStaged.length > 1 ? reposWithStaged : reposWithChanges;
        // We cannot show a QuickPick synchronously from a synchronous function,
        // so log a warning and fall through to strategy 5.
        console.warn(
            `Kung Commit: ${candidates.length} repos have changes — using first repo. ` +
            `Consider switching to the correct repo before generating a commit message.`,
        );
    }

    // Strategy 5: first repository (default fallback)
    console.log(`Kung Commit: using first repository: ${repos[0].rootUri.fsPath}`);
    return repos[0];
}

/**
 * Get the active Git extension API handle and the resolved repository.
 * Logs diagnostic info so the user can see which repo/branch the extension
 * is targeting (visible in Developer Tools console).
 */
function getGitExtension(): { api: GitAPI; repository: Repository } {
    const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExt) {
        throw new Error('Git extension not found. Please make sure the built-in Git extension is enabled.');
    }

    if (!gitExt.isActive) {
        gitExt.activate();
    }

    const api = gitExt.exports.getAPI(1);
    const repository = getActiveRepository(api);

    const rootPath = repository.rootUri.fsPath;
    const branchName = repository.state.HEAD?.name || '(detached HEAD)';
    const gitPath = api.git.path;
    console.log(`Kung Commit: repo = ${rootPath}, branch = ${branchName}, git = ${gitPath}`);

    return { api, repository };
}

/**
 * Get the active Git repository (legacy export — used by extension.ts for
 * inserting messages into the SCM input box).
 */
export async function getRepository(): Promise<Repository> {
    return getGitExtension().repository;
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
 * repository state properties. Used as a heuristic only — not a gate.
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
 * Attempt to retrieve a diff via the Git extension API, with optional retry
 * after refreshing the repository state. Returns the diff string, or
 * `undefined` if no diff could be obtained.
 */
async function tryGetDiff(
    repository: Repository,
    staged: boolean,
    attempt: number = 1,
): Promise<string | undefined> {
    const label = staged ? 'staged' : 'unstaged';

    for (let i = 0; i < attempt; i++) {
        if (i > 0) {
            await refreshRepository(repository);
        }

        try {
            const diff = await repository.diff(staged);
            if (diff.trim().length > 0) {
                console.log(`Kung Commit: Git API returned ${label} diff (${diff.length} chars)`);
                return diff;
            }
        } catch (error: any) {
            console.warn(`Kung Commit: repository.diff(${staged}) threw (attempt ${i + 1}/${attempt}): ${error.message || error}`);
        }
    }

    console.warn(`Kung Commit: Git API ${label} diff empty after ${attempt} attempt(s)`);
    return undefined;
}

/**
 * Build a combined diff header that describes which sections are staged
 * vs. unstaged.
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
// Shell-based fallbacks using the Git extension's own Git binary
// ---------------------------------------------------------------------------

const execAsync = promisify(exec);

/**
 * Run a raw git command using the exact Git binary that the VS Code Git
 * extension has discovered. On Windows, the bundled Git for Windows is
 * often NOT on the system PATH, so using `git` bare would fail silently.
 * Using the extension's discovered path guarantees it works wherever the
 * Git extension itself works.
 */
async function runGit(
    gitPath: string,
    cwd: string,
    args: string[],
): Promise<{ stdout: string; stderr: string }> {
    // Quote the git path to handle spaces (e.g., "Program Files")
    const command = `"${gitPath}" ${args.join(' ')}`;

    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
        });
        return { stdout, stderr };
    } catch (error: any) {
        // exec throws on non-zero exit; stdout/stderr may still be populated
        return {
            stdout: error.stdout || '',
            stderr: error.stderr || error.message || '',
        };
    }
}

/**
 * Execute `git diff` via the shell, returning the diff output.
 */
async function shellGitDiff(
    gitPath: string,
    cwd: string,
    staged: boolean,
): Promise<string> {
    const args = staged
        ? ['diff', '--cached', '--no-color']
        : ['diff', '--no-color'];

    const { stdout, stderr } = await runGit(gitPath, cwd, args);

    if (stderr && stderr.trim()) {
        console.warn(`Kung Commit: shell git diff (staged=${staged}) stderr: ${stderr}`);
    }

    return stdout || '';
}

/**
 * Run `git status --porcelain` via the shell and return a structured
 * human-readable summary of all changes (including untracked files).
 */
async function shellGitStatus(gitPath: string, cwd: string): Promise<string> {
    const { stdout } = await runGit(gitPath, cwd, ['status', '--porcelain']);

    if (!stdout || !stdout.trim()) {
        return '';
    }

    const lines = stdout.trim().split('\n');
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];
    const conflicted: string[] = [];

    for (const line of lines) {
        if (line.startsWith('??')) {
            untracked.push(line.substring(3).trim());
            continue;
        }

        const statusChar1 = line[0];
        const statusChar2 = line[1];
        const file = line.substring(3).trim();

        // Check for conflicted (U in any position, or DD/AA)
        if (statusChar1 === 'U' || statusChar2 === 'U' ||
            (statusChar1 === 'D' && statusChar2 === 'D') ||
            (statusChar1 === 'A' && statusChar2 === 'A')) {
            conflicted.push(`${statusChar1}${statusChar2} ${file}`);
            continue;
        }

        if (statusChar1 !== ' ' && statusChar1 !== '?') {
            staged.push(`${statusChar1} ${file}`);
        }

        if (statusChar2 !== ' ' && statusChar2 !== '?') {
            unstaged.push(`${statusChar2} ${file}`);
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

    const header =
        'NOTE: This is a file-status summary (not a full patch) because ' +
        'the changes include untracked files or the diff could not be retrieved.\n\n';

    return header + parts.join('\n\n');
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------


/**
 * Extract the git diff from the current workspace repository.
 *
 * Strategy (three phases):
 *   1. Git extension API  — `repository.diff()` (fast, no subprocess)
 *   2. Shell `git diff`   — using the Git extension's discovered binary path
 *   3. `git status`       — catches untracked files that `git diff` ignores
 *
 * If ALL phases return nothing, throws "No changes detected".
 */
export async function getDiff(): Promise<string> {
    const { api, repository } = getGitExtension();
    const rootPath = repository.rootUri.fsPath;
    const gitPath = api.git.path;
    const maxDiffChars = getMaxDiffChars();

    // --- Phase 1: Git extension API ---
    // Always refresh first so the internal state is current.
    await refreshRepository(repository);

    console.log('Kung Commit: Phase 1 — Git extension API diff()...');
    let stagedDiff = await tryGetDiff(repository, true, 2);
    let unstagedDiff = await tryGetDiff(repository, false, 2);

    // --- Phase 2: Shell git diff using extension's Git binary ---
    if (!stagedDiff && !unstagedDiff) {
        console.log(`Kung Commit: Phase 2 — shell \`"${gitPath}" diff\`...`);
        stagedDiff = await shellGitDiff(gitPath, rootPath, true);
        unstagedDiff = await shellGitDiff(gitPath, rootPath, false);

        if (stagedDiff) console.log(`Kung Commit: shell got staged diff (${stagedDiff.length} chars)`);
        if (unstagedDiff) console.log(`Kung Commit: shell got unstaged diff (${unstagedDiff.length} chars)`);
    }

    // --- Phase 3: git status --porcelain (catches untracked files) ---
    if (!stagedDiff && !unstagedDiff) {
        console.log(`Kung Commit: Phase 3 — shell \`"${gitPath}" status --porcelain\`...`);
        const statusOutput = await shellGitStatus(gitPath, rootPath);
        if (statusOutput) {
            console.log(`Kung Commit: git status found changes (${statusOutput.length} chars)`);
            return truncateDiff(statusOutput, maxDiffChars);
        }
        console.warn('Kung Commit: All three phases returned empty.');
    }

    // --- Build the final diff ---
    let diff: string;

    if (stagedDiff && unstagedDiff) {
        diff = buildCombinedDiff(stagedDiff, unstagedDiff);
    } else if (stagedDiff) {
        diff = stagedDiff;
    } else if (unstagedDiff) {
        diff = unstagedDiff;
    } else {
        console.error('Kung Commit: No diff could be obtained from any source.');
        throw new Error('No changes detected in the repository. Stage or modify files first.');
    }

    console.log(`Kung Commit: final diff = ${diff.length} chars`);
    return truncateDiff(diff, maxDiffChars);
}

// ---------------------------------------------------------------------------
// Branch diff for PR description generation
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
 * @throws Error if no base branch can be determined.
 */
export async function detectBaseBranch(repository: Repository): Promise<string> {
    const head = repository.state.HEAD;

    // If we have an upstream tracking branch, try it first
    if (head?.name && repository.state.upstream?.name) {
        const upstream = repository.state.upstream.name;
        const shortUpstream = upstream.replace(/^refs\/remotes\//, '');
        try {
            const testDiff = await repository.diffBetween(shortUpstream, 'HEAD');
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
