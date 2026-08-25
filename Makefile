format:
	@yarn format:check

typos:
	@typos --config ./.github/workflows/config/typos.toml src/. README.md

.PHONY: typos format
