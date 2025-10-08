BUN_BUILD_OPTS = --target=browser --minify --sourcemap=external
include .env

web-ext-artifacts/webext.zip: out/settings/settings.html out/background.js out/manifest.json
	cp -r icons out/
	bun x web-ext build -s ./out -n webext.zip -o

web-ext-artifacts/source.zip: manifest.json background.js settings/settings.html settings/settings.js settings/settings.css icons/ Makefile
	mkdir -p web-ext-artifacts
	zip -r $@ $^

out/manifest.json: manifest.json
	cp manifest.json out/

out/settings/settings.html: settings/settings.html settings/settings.js settings/settings.css
	rm -r out/settings || true
	bun build settings/settings.html --outdir=out/settings $(BUN_BUILD_OPTS)

out/background.js: background.js
	bun build background.js --outdir=out $(BUN_BUILD_OPTS)

.PHONY: clean sign
clean:
	rm -rf out web-ext-artifacts

sign: web-ext-artifacts/webext.zip web-ext-artifacts/source.zip
	@bun x web-ext sign \
    	--api-key $(JWT_ISSUER) --api-secret $(JWT_SECRET) \
        -s out/ --upload-source-code ./web-ext-artifacts/source.zip --channel unlisted
