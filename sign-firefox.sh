#!/bin/sh
# Signs the extension with Mozilla ("unlisted": not published on the store, just signed so Firefox installs it for good).
# 1. Create API keys (free): https://addons.mozilla.org/developers/addon/api/key/
# 2. Run:  AMO_JWT_ISSUER=user:xxxx AMO_JWT_SECRET=yyyy ./sign-firefox.sh
# 3. Open the .xpi written to ./signed/ in Firefox (drag it onto a Firefox window) -> permanent install.
set -e
cd "$(dirname "$0")"
: "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER (see comment at the top)}"
: "${AMO_JWT_SECRET:?set AMO_JWT_SECRET (see comment at the top)}"
npx --yes web-ext@latest sign --source-dir extension --ignore-files test.js --channel unlisted \
  --api-key "$AMO_JWT_ISSUER" --api-secret "$AMO_JWT_SECRET" --artifacts-dir signed
