# Show available commands
default:
    @just --list

build-target := justfile_directory() + "/.cargo-target-build"
test-target := justfile_directory() + "/.cargo-target-test"
lint-target := justfile_directory() + "/.cargo-target-lint"

# Build the Rust library and generate .node binary
build:
	cd lib && CARGO_TARGET_DIR='{{build-target}}' npm run build

# Run the demo application
dev:
    cd app && bun run dev

# Run Rust unit tests
test-rust:
	cd lib && CARGO_TARGET_DIR='{{test-target}}' cargo test

# Run E2E tests
test-e2e:
	python -c "import shutil; shutil.rmtree('.tui-test/cache', ignore_errors=True); shutil.rmtree('.cargo-target-test', ignore_errors=True)"
	bunx @microsoft/tui-test app/tests/e2e/*.test.ts

# Run all tests
test: test-rust test-e2e

# Run linter
lint:
	cd lib && CARGO_TARGET_DIR='{{lint-target}}' cargo clippy -- -D warnings

# Run tests and linter
check: test lint
