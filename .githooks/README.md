# Git hooks

`pre-commit` auto-bumps the `VERSION` string in `sw.js` whenever `index.html`,
`sw.js`, or `manifest.json` is part of a commit. This gives every deploy a unique
service-worker version so installed PWAs refresh their cache and pick up the new
build automatically.

## One-time setup (per clone)

Git does not track which hooks directory a repo uses, so each machine must point
git at this folder once:

```
git config core.hooksPath .githooks
```

That's it — commits from then on will bump `sw.js` automatically. Requires Node
on the PATH (already needed for the Appwrite setup script). If Node is missing
the hook is skipped and the commit still succeeds.
