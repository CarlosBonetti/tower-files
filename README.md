# tower-files

A file viewer for [the tower](https://github.com/RegiByte/the-tower), the local HQ for many Claude Code sessions: an extension (`extension.json`) and the "All files" pane, a renderer in `renderer/`
framed on a floor's shelf: the floor's files as a folding tree, and the one picked open in
[Monaco](https://github.com/microsoft/monaco-editor), VS Code's editor, highlighted by [Shiki](https://shiki.style)
with VS Code's TextMate grammars and its Light+ / Dark+ themes (through `@shikijs/monaco`). Cmd/Ctrl+S saves.

![All files on the tower's own floor: its tree, with src/tower/server.ts open in Monaco](docs/screenshot.png)

## Build

`npm install && npm run build` bundles the pane into `renderer/out/` (git-ignored), so it loads nothing from the
network; `npm run build -- --watch` while working on it. `renderer/src/files.js` is the page.

## The API

`GET /files/tree/<project>` lists the files of the floor's hub, then its repos, as git sees each (tracked, and
untracked but not ignored), or every file but those under `.git` and `node_modules` in a directory outside git: `{ project, roots: [{ dir, files, error? }] }`, `files` relative to `dir` in name order.
`GET /files/file/<project>?dir=&path=` reads one: `{ dir, path, size, version, lang, text?, binary?, truncated? }`,
`lang` the Shiki grammar its name calls for, the first 1 MB sent. `POST /files/write {project, dir, path, text, base}`
saves an existing file, refused when it changed since `base`, the `version` it was read at; `tower x files write
'<json>'` from a worker. Each takes only a directory of the floor and a path inside it.

A page reads them with `tower.get('files/tree/<project>')` and `tower.call('files/write', …)`; after editing `server.ts`, `tower extensions restart files`.

## Install

In `~/.tower/config.json`:

```json
"extensions": { "files": { "path": "/abs/path/to/tower-files" } },
"renderers": { "files": { "root": "/abs/path/to/tower-files/renderer", "settings": { "project": "my-app" } } },
"projects": { "my-app": { "shelf": [{ "label": "All files", "renderer": "files" }] } }
```

One renderer serves every floor: framed on a floor's shelf, the pane shows that floor's files, so each floor that wants
it adds the same shelf entry. `settings.project` is the floor it shows when opened on its own, at `/r/files/`.

`tower extensions check /abs/path/to/tower-files` reads the extension as the tower would.
