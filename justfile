_default:
    @just --list

index:
	cargo run --release --quiet --manifest-path indexer/Cargo.toml

clean:
	rm -rf static/data/hk static/data/ss
