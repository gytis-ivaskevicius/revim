# Show available commands
default:
    @just --list

# Build the Rust library and generate .node binary
build:
	cd lib && CARGO_TARGET_DIR=/tmp/revim-cargo-target npm run build

# Run the demo application
dev:
    cd app && bun run dev

# Run Rust unit tests
test-rust:
	cd lib && CARGO_TARGET_DIR=/tmp/revim-cargo-target cargo test

# Run E2E tests
test-e2e:
	python -c "import shutil; shutil.rmtree('/home/gytis/ai/revim/.tui-test/cache', ignore_errors=True); shutil.rmtree('/home/gytis/ai/revim/lib/target', ignore_errors=True)"
	bunx @microsoft/tui-test app/tests/e2e/*.test.ts

# Run all tests
test: test-rust test-e2e

# Run linter
lint:
	cd lib && CARGO_TARGET_DIR=/tmp/revim-cargo-target cargo clippy -- -D warnings

# Run tests and linter
check: test lint
