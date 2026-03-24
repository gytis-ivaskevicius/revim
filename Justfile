# Show available commands
default:
    @just --list

# Build the Rust library and generate .node binary
build:
    cd lib && npm run build

# Run the demo application
dev:
    cd app && bun run dev

# Run tests
test:
    cd lib && cargo test

# Run linter
lint:
    cd lib && cargo clippy -- -D warnings

# Run tests and linter
check: test lint