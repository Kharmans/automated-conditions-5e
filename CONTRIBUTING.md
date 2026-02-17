# Contributing

## Branch and commit basics
- Create focused commits by topic (code, docs, translations, wiki).
- Keep `Changelog.md` updated for user-facing changes.
- Prefer small PRs with clear titles and test notes.

## Editing the Wiki locally in VS Code
This repository can mirror the GitHub Wiki into a tracked `wiki/` folder, so you can edit wiki pages like normal files.

### 1) First-time import (or refresh from remote wiki)
Run in PowerShell from repo root:

```powershell
.\scripts\wiki-pull.ps1
```

What this does:
- Clones `https://github.com/thatlonelybugbear/automated-conditions-5e.wiki.git` to a temp folder.
- Mirrors all wiki files into local `wiki/`.

### 2) Edit locally
- Open `wiki/` in VS Code.
- Edit/add/remove `.md` pages and assets.
- Commit changes to this repository.

### 3) Publish to GitHub Wiki
- Push committed `wiki/` changes to `main`.
- Workflow `.github/workflows/publish-wiki.yml` publishes local `wiki/` content to the GitHub Wiki.
- You can also run the same workflow manually via `workflow_dispatch`.

## Wiki publish workflow details
- Triggered on push to `main` when files under `wiki/**` change.
- Safe guard: if `wiki/` is missing or empty, publish is skipped to avoid accidental wiki wipe.
- Auth:
  - Uses `WIKI_PUSH_TOKEN` secret if present.
  - Falls back to default `GITHUB_TOKEN`.

## Recommended token setup
If the fallback token cannot push to wiki in your repo settings, add a repository secret:
- Name: `WIKI_PUSH_TOKEN`
- Value: a PAT with repository write access.
