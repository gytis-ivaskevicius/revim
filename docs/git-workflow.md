---
description: Read when making commits or creating branches. Defines commit format, branch naming, and autocommit rules.
---

<!--
Run `git log` to identify existing commit conventions.
If not a git repo, ask user before running `git init`.
Present the defaults below, discuss with the user. Key things to resolve:
- Commit message format (if conventional commits, don't explain the standard — only note exceptions)
- Whether commits must include a ticket ID (e.g., Jira)
- Autocommit rules
Once agreed, update this file and delete this comment.
-->

## Rules

- Commit format: Conventional commits
  - Use `plan(<feature>):` prefix for planning/story commits
- Never autocommit without explicit user approval
