---
description: Read when writing or modifying tests. Defines framework, file conventions, coverage targets, and test priorities.
---

<!--
Explore the codebase to identify existing test patterns, frameworks, and file conventions.
Present what you find as defaults and discuss with the user. Key things to resolve:
- Test framework and assertion library (e.g., Vitest, Jest, Playwright)
- Where test files live (colocated *.test.ts, __tests__/ dir, separate test/ tree)
- Coverage expectations per layer
Once agreed, update this file and delete this comment.
-->

# Testing Strategy

## Framework & Tooling

<!-- e.g., Vitest + React Testing Library, Jest, Playwright -->

## File Conventions

<!-- e.g., colocated *.test.ts next to source, or __tests__/ directories -->

## Test Priority

1. Unit tests (preferred)
2. Integration tests
3. E2E

## Coverage

- Core logic: 100%
- UI: 80%
- Project minimum: 90%

