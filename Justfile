# Show available commands
default:
    @just --list

# Build the Rust library and generate .node binary
build:
	cd lib && npm run build

# Run the demo application
dev: build
    cd app && bun run dev

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
	cd lib && cargo clippy -- -D warnings

# Run tests and linter
check: test lint
