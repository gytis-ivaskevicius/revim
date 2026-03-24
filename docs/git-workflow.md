---
description: Read when making commits or creating branches. Defines commit format, branch naming, and autocommit rules.
---

## Rules

- Commit format: Conventional commits
  - Use `plan(<feature>):` prefix for planning/story commits
  - Use `feat(<feature>):` for feature implementation
  - Use `fix(<feature>):` for bug fixes
  - Use `chore:` for maintenance tasks
- Never autocommit without explicit user approval
- Branch naming: `<number>-<short-name>` (e.g., `001-napi-ffi-poc`)
- Always create branch before starting work