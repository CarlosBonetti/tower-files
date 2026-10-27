# tower-files

A file viewer for the tower: an extension (`extension.json`) and the "All files" pane, a renderer in `renderer/`
framed on a floor's shelf. A placeholder for now.

## Install

In `~/.tower/config.json`:

```json
"extensions": { "files": { "path": "/abs/path/to/tower-files" } },
"renderers": { "files": { "root": "/abs/path/to/tower-files/renderer", "settings": { "project": "the-tower" } } },
"projects": { "the-tower": { "shelf": [{ "label": "All files", "renderer": "files" }] } }
```

`tower extensions check /abs/path/to/tower-files` reads the extension as the tower would.
