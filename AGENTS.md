# Git Workflow Rules (Mandatory)
- NEVER commit or push directly to `main`.
- Before writing code for any task, create a new branch from up-to-date `main`:
  - `feat/<short-kebab-description>` for new features and UI improvements
  - `fix/<short-kebab-description>` for bug fixes
  - `refactor/<short-kebab-description>` for code cleanup and architecture changes
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).
- Always verify `npx tsc --noEmit && npm run build` before committing.
- Push the feature/fix branch to `origin` (`git push -u origin <branch-name>`) after completing the task.
