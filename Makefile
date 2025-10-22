BUN_BUILD_OPTS = --target=browser --minify --sourcemap=external
-include .env

web-ext-artifacts/webext.zip: out/settings/settings.html out/background.js out/manifest.json
	cp -r src/icons out/
	bun x web-ext build -s ./out -n webext.zip -o

web-ext-artifacts/source.zip: src/ manifest.json Makefile package.json README.md tsconfig.json LICENSE
	mkdir -p web-ext-artifacts
	zip -r $@ $^

out/manifest.json: manifest.json
	cp manifest.json out/

out/settings/settings.html: $(wildcard src/settings/*) src/defaults.ts
	rm -r out/settings || true
	bun build src/settings/settings.html --outdir=out/settings $(BUN_BUILD_OPTS)

out/background.js: src/background.js src/defaults.ts src/tab.js
	bun build src/background.js --outdir=out $(BUN_BUILD_OPTS)

.PHONY: clean sign check lint knip fix
clean:
	rm -rf out web-ext-artifacts

sign: web-ext-artifacts/webext.zip web-ext-artifacts/source.zip
	@bun x web-ext sign \
    	--api-key $(JWT_ISSUER) --api-secret $(JWT_SECRET) \
        -s out/ --upload-source-code ./web-ext-artifacts/source.zip --channel unlisted

check:
	bunx tsc --noEmit

lint:
	bunx --bun biome check --fix

knip:
	bunx knip --fix --fix-type types --fix-type exports

fix: check lint knip
