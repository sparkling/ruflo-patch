---
name: Verdaccio local registry setup
description: Verdaccio is systemd-managed, publish:$all, dummy _auth in .npmrc — never start manually
type: reference
---

Verdaccio is the local npm registry for development/testing.

**Managed by systemd** — NEVER start verdaccio manually:
- Service: `systemctl --user status verdaccio`
- Restart: `systemctl --user restart verdaccio`
- Config: `/home/claude/.verdaccio/config.yaml`
- Service file: `/home/claude/.config/systemd/user/verdaccio.service`
- Storage: `/home/claude/.verdaccio/storage`

**Auth config**: `publish: $all` (no real auth). npm 11.x requires *some* auth in `.npmrc` but Verdaccio never validates it. Use dummy `_auth`:
```
registry=http://localhost:4873
//localhost:4873/:_auth=bm9ib2R5Om5vYm9keQ==
```

**NPM_TOKEN env var**: exists in shell env but is for registry.npmjs.org, not local Verdaccio. Pipeline scripts should use `--registry http://localhost:4873` explicitly.

**Port**: 4873 (localhost only)
