# Show available commands
default:
    @just --list

# Build the Rust library and generate .node binary
build:
	cd packages/core && npm run build

# Run the demo application
dev *args: build
	cd packages/app && bun run src/index.ts {{args}}

# Run TypeScript unit tests
test-unit:
	bun test packages/app/tests/unit/

# Run Rust unit tests
test-rust:
	cd packages/core && cargo test

# Run E2E tests
test-e2e: build
	bunx @microsoft/tui-test packages/app/tests/e2e/*.test.ts

# Run all tests
test: test-rust test-unit test-e2e

# Run linter
lint:
	cd packages/app && npx tsc --noEmit
	cd packages/core && cargo clippy -- -D warnings
	bunx biome check

# Auto-fix lint issues
lint-fix:
	bunx biome check --write --unsafe
	cd packages/app && npx tsc --noEmit
	cd packages/core && cargo clippy --fix --allow-dirty -- -D warnings

# Run tests and linter
check: test lint
