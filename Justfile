# Show available commands
default:
    @just --list

# Build the Rust library and generate .node binary
build:
	cd lib && npm run build

# Run the demo application
dev *args: build
	cd app && bun run src/index.ts {{args}}

# Run Rust unit tests
test-rust:
	cd lib && cargo test

# Run E2E tests
test-e2e: build
	bunx @microsoft/tui-test app/tests/e2e/*.test.ts

# Run all tests
test: test-rust test-e2e

# Run linter
lint:
	cd app && npx tsc --noEmit
	cd lib && cargo clippy -- -D warnings
	bunx biome check

# Auto-fix lint issues
lint-fix:
	bunx biome check --write --unsafe
	cd app && npx tsc --noEmit
	cd lib && cargo clippy --fix --allow-dirty -- -D warnings

# Run tests and linter
check: test lint
