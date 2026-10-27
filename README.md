# tower-files

A file viewer for the tower: an extension (`extension.json`) and the "All files" pane, a renderer in `renderer/`
framed on a floor's shelf, drawing the floor's files as a folding tree.

## The API

`GET /files/tree/<project>` lists the files of the floor's hub, then its repos, as git sees each (tracked, and
untracked but not ignored): `{ project, roots: [{ dir, files, error? }] }`, `files` relative to `dir` in name order.
A page reads it with `tower.get('files/tree/<project>')`; after editing `server.ts`, `tower extensions restart files`.

## Install

In `~/.tower/config.json`:

```json
"extensions": { "files": { "path": "/abs/path/to/tower-files" } },
"renderers": { "files": { "root": "/abs/path/to/tower-files/renderer", "settings": { "project": "the-tower" } } },
"projects": { "the-tower": { "shelf": [{ "label": "All files", "renderer": "files" }] } }
```

`tower extensions check /abs/path/to/tower-files` reads the extension as the tower would.
