---
description: Run the offline gate, commit in the repo's voice, then ask before pushing (push deploys bubhub.us)
agent: build
---

Ship the current BubHub changes. Work from the repo root.

1. Run `./test.sh --skip-browser` and stop if it fails.
2. Review `git status` and `git diff`; stage only the intended files. Never stage `dist/`, `node_modules/`, `.wrangler/`, or anything holding a credential.
3. Commit with a short lowercase subject (`registry: …`, `eggs: …`, `docs: …`) and a body that says what changed and why.
4. Do NOT push. Report the commit hash and ask whether to publish. Pushing `main` deploys bubhub.us, so it is a release, not a save.

Extra context from the user: $ARGUMENTS
