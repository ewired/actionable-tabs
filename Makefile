BROWSER ?= firefox
-include .env
export WEB_EXT_API_KEY WEB_EXT_API_SECRET

dist/$(BROWSER)/manifest.json: $(shell find src -type f)
	bun run build -- --browser=$(BROWSER) --zip --zip-source

.PHONY: clean sign-firefox check lint knip fix
clean:
	rm -rf dist

sign-firefox: dist/firefox/manifest.json
	SOURCE_ZIP=$$(ls dist/*-source.zip 2>/dev/null | head -1) && \
	if [ -z "$$SOURCE_ZIP" ]; then echo "Source zip not found" >&2; exit 1; fi && \
	bun x web-ext sign \
		-s dist/firefox --upload-source-code "$$SOURCE_ZIP" \
		-a dist --channel unlisted

check:
	bunx tsc --noEmit

lint:
	bunx --bun biome check --fix

knip:
	bunx knip --fix --fix-type types --fix-type exports

fix: check lint knip
