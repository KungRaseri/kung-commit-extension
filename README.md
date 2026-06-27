# 🥋 Kung Commit

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-blue)](https://marketplace.visualstudio.com/items?itemName=kung-commit.kung-commit)

Generate **conventional commit messages** and **PR descriptions** from your Git changes using AI.

Supports **OpenAI**, **Anthropic** (Claude), **DeepSeek**, and any **OpenAI-compatible custom endpoint**.

---

## Features

### ✨ AI-Powered Commit Messages

Click the **Kung Commit** button in the Source Control toolbar to automatically generate a conventional commit message from your staged (or unstaged) changes.

- [Conventional Commits](https://www.conventionalcommits.org/) format (`<type>(<scope>): <description>`)
- Auto-detects staged diff first, falls back to unstaged
- Configurable prompt templates
- Multi-locale support for non-English messages
- Optional preview before inserting into the commit input box

### 🔀 PR Description Generation

Click the **PR Description** button to generate a structured pull request title and description from the diff between your feature branch and the base branch.

- Auto-detects the base branch (`main` / `master` / upstream tracking)
- Generates a title + Markdown body with Summary, Changes, Breaking Changes, and Related Issues sections
- Copies the result to your clipboard
- Optionally opens the GitHub PR creation view automatically

### 💡 CodeLens Integration

When viewing a Git diff editor, a **Generate AI Commit Message** CodeLens link appears above the diff, giving you one-click access to commit message generation.

---

## Supported AI Providers

| Provider      | Default Model                    | Endpoint                              |
|---------------|----------------------------------|---------------------------------------|
| **OpenAI**    | `gpt-4o-mini`                    | `https://api.openai.com/v1`           |
| **Anthropic** | `claude-sonnet-4-20250514`       | `https://api.anthropic.com`           |
| **DeepSeek**  | `deepseek-chat`                  | `https://api.deepseek.com`            |
| **Custom**    | Configurable                     | Any OpenAI-compatible API endpoint    |

---

## Installation

### From VS Code Marketplace

1. Open **VS Code**
2. Go to the **Extensions** view (`Ctrl+Shift+X`)
3. Search for **"Kung Commit"**
4. Click **Install**

### From VSIX

1. Download the latest `.vsix` from [Releases](https://github.com/kung-commit/vscode-kung-commit/releases)
2. In VS Code, run **Extensions → Install from VSIX...**
3. Select the downloaded file

---

## Getting Started

1. **Configure an API key** (choose one):
   - Set `kungCommit.apiKey` in VS Code settings
   - Or set the `KUNG_COMMIT_API_KEY` environment variable

2. **Select your AI provider** (optional):
   - Set `kungCommit.provider` to `openai`, `anthropic`, `deepseek`, or `custom`
   - Default: `deepseek`

3. **Open a Git repository** and stage some changes

4. Click the **Kung Commit** button (🥋) in the Source Control title bar

5. The generated commit message appears in the SCM input box — review and commit!

---

## Configuration

All settings are under the `kungCommit.*` namespace.

### Core Settings

| Setting                          | Default                  | Description                                              |
|----------------------------------|--------------------------|----------------------------------------------------------|
| `kungCommit.provider`            | `deepseek`               | AI provider: `openai`, `anthropic`, `deepseek`, `custom` |
| `kungCommit.apiKey`              | `""`                     | API key (or use `KUNG_COMMIT_API_KEY` env var)           |
| `kungCommit.model`               | `deepseek-chat`          | Model name override                                      |
| `kungCommit.customEndpoint`      | `""`                     | Custom API endpoint URL (for `custom` provider)          |
| `kungCommit.customModel`         | `""`                     | Custom model name (for `custom` provider)                |
| `kungCommit.customHeaders`       | `{}`                     | Additional HTTP headers for custom endpoint              |

### Commit Message Settings

| Setting                        | Default                                          | Description                                      |
|--------------------------------|--------------------------------------------------|--------------------------------------------------|
| `kungCommit.promptTemplate`    | `Generate a concise conventional commit message...` | Prompt template (`{{diff}}` placeholder)          |
| `kungCommit.maxDiffChars`      | `4000`                                           | Max diff characters sent to the AI                |
| `kungCommit.locale`            | `en`                                             | Locale for generated messages (e.g., `ja`, `zh-CN`) |
| `kungCommit.autoPreview`       | `true`                                           | Show preview before inserting into input box      |
| `kungCommit.showCodeLens`      | `true`                                           | Show CodeLens in diff editors                     |

### PR Description Settings

| Setting                          | Default | Description                                              |
|----------------------------------|---------|----------------------------------------------------------|
| `kungCommit.prPromptTemplate`    | _(PR-specific template)_ | Prompt template (`{{diff}}`, `{{baseBranch}}`, `{{headBranch}}`) |
| `kungCommit.autoOpenPRView`      | `false` | Automatically open GitHub PR creation view after generation |

---

## Usage

### Generating a Commit Message

1. **Stage** your changes (or leave them unstaged)
2. In the **Source Control** view (`Ctrl+Shift+G`), click the **Kung Commit** button (🥋) in the toolbar
3. The AI analyzes your diff and inserts a conventional commit message into the input box
4. (If `autoPreview` is enabled) Review the message in the preview dialog
5. Make any edits and commit

### Generating a PR Description

1. Check out your **feature branch**
2. In the **Source Control** view, click the **PR Description** button (`$(git-pull-request)`)
3. The AI detects the base branch, analyzes the diff, and generates a PR title + description
4. The result is **copied to your clipboard**
5. Paste it into your PR creation form on GitHub/GitLab

---

## Prompt Templates

You can customize the prompt sent to the AI using the following placeholders:

| Placeholder      | Available In               | Description                     |
|------------------|----------------------------|---------------------------------|
| `{{diff}}`       | Commit & PR templates      | The Git diff content            |
| `{{baseBranch}}` | PR template only           | Detected base branch name       |
| `{{headBranch}}` | PR template only           | Current feature branch name     |

### Example: Custom Commit Prompt

```
As a senior code reviewer, generate a commit message for these changes:

{{diff}}

Follow the Conventional Commits specification.
```

### Example: Custom PR Prompt

```
Write a pull request description for the changes between {{baseBranch}} and {{headBranch}}.

{{diff}}

Structure it with ## Overview, ## Technical Details, and ## Testing sections.
```

---

## Development

```bash
# Clone the repository
git clone https://github.com/kung-commit/vscode-kung-commit.git
cd vscode-kung-commit

# Install dependencies
npm install

# Compile the extension
npm run compile

# Watch mode (auto-compile on changes)
npm run watch

# Package into VSIX
npm run package
```

### Project Structure

```
kung-commit/
├── src/
│   ├── extension.ts            # Extension entry point & command handlers
│   ├── config.ts               # Typed settings reader
│   ├── aiProvider.ts           # AI provider interface, base class, and implementations
│   ├── gitDiff.ts              # Git diff extraction (staged/unstaged/branch)
│   ├── gitExtensionTypes.d.ts  # Type declarations for vscode.git API
│   ├── statusBar.ts            # Status bar progress indicator
│   ├── commitLens.ts           # CodeLens provider for diff editors
│   └── ...
├── media/
│   ├── icon-light.svg          # Light theme toolbar icon
│   └── icon-dark.svg           # Dark theme toolbar icon
├── architecture/
│   ├── PLAN.md                 # Architecture plan
│   └── PR_SUPPORT.md           # PR generation feature architecture
├── package.json                # Extension manifest
├── tsconfig.json               # TypeScript configuration
└── LICENSE                     # MIT license
```

---

## Architecture

Detailed architecture documentation is available in the [`architecture/`](architecture/) directory:

- [Architecture Plan](architecture/PLAN.md) — overall design, data flow, provider pattern
- [PR Support Architecture](architecture/PR_SUPPORT.md) — PR description generation feature design

---

## Requirements

- **VS Code** `^1.96.0`
- **Git** extension (built-in, automatically enabled)
- An API key for your chosen AI provider

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`npm run compile` to verify)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

## Acknowledgments

- Built on the [VS Code Extension API](https://code.visualstudio.com/api)
- Inspired by conventional commits and AI-assisted development workflows
