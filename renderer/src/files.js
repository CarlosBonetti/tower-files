// The "All files" pane: a renderer framed on a floor's shelf. Everything in the floor's directories as a folding
// tree, and the file picked open in Monaco, VS Code's editor, highlighted by Shiki with VS Code's TextMate grammars
// and Light+ / Dark+ themes; Cmd/Ctrl+S saves it through `files/write`.
import { shikiToMonaco } from '@shikijs/monaco'
import { createHighlighter } from 'shiki'
import * as monaco from './monaco.js'

const THEMES = { light: 'light-plus', dark: 'dark-plus' }

// The floor: the one whose shelf frames the page, or the renderer's `settings.project` when it runs on its own.
const { settings } = await tower.renderer()
const shelf = await new Promise((resolve) => {
  const off = tower.subscribe((_board, entry) => {
    resolve(entry)
    queueMicrotask(() => off())
  })
})
const project = shelf?.project ?? settings.project
document.getElementById('floor').textContent = project

// Framed, the page has an opaque origin, which can't start a worker from a URL: a blob of the same origin loads it.
const workerUrl = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(new URL('editor.worker.js', import.meta.url).href)})`], { type: 'text/javascript' }))
self.MonacoEnvironment = { getWorker: () => new Worker(workerUrl) }

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

// The tree: each folder's entries read when it is first opened (`files/entries/<project>`), so it shows everything,
// node_modules too, at the cost of one read per folder opened. What git ignores is dimmed, as VS Code's explorer does.

const entriesOf = (dir, path) =>
  tower.get(`files/entries/${encodeURIComponent(project)}?${new URLSearchParams({ dir, path })}`)

const drawFolder = async (dir, path) => {
  const list = el('ul', 'tree')
  const { entries } = await entriesOf(dir, path)
  if (!entries.length) list.append(el('li', 'note', 'Empty'))
  for (const { name, kind, ignored } of entries) {
    const item = el('li')
    if (ignored) item.className = 'ignored'
    const at = path ? `${path}/${name}` : name
    if (kind === 'file') {
      const file = el('button', 'file', name)
      file.type = 'button'
      file.dataset.key = `${dir}/${at}`
      file.addEventListener('click', () => openFile(dir, at))
      item.append(file)
    } else {
      const details = el('details')
      details.append(el('summary', 'folder', name))
      details.addEventListener('toggle', async () => details.append(await drawFolder(dir, at)), { once: true })
      item.append(details)
    }
    list.append(item)
  }
  return list
}

const drawRoot = async (dir) => {
  const section = el('section', 'root')
  const head = el('h2', undefined, dir.split('/').at(-1))
  head.append(el('small', undefined, ` ${dir}`))
  section.append(head, await drawFolder(dir, ''))
  return section
}

// The splitter: drag it, or focus it and use the arrow keys, to size the tree; a double click resets it. The width
// is view state, kept in tower.store under `files.treeWidth` for every page of the viewer's.

const TREE_WIDTH = 'files.treeWidth'
const panes = document.querySelector('.panes')
const splitter = document.getElementById('splitter')
const widthOf = (px) => Math.round(Math.min(Math.max(px, 160), panes.clientWidth - 240))
const setWidth = (px) => {
  const width = widthOf(px)
  panes.style.setProperty('--tree-width', `${width}px`)
  splitter.setAttribute('aria-valuenow', String(width))
  return width
}
const treeWidth = () => document.getElementById('files').getBoundingClientRect().width
const keepWidth = (px) => tower.store.set(TREE_WIDTH, px === undefined ? null : setWidth(px))

const stored = await tower.store.get(TREE_WIDTH)
if (stored) setWidth(stored)
splitter.addEventListener('pointerdown', (down) => {
  splitter.setPointerCapture(down.pointerId)
  splitter.dataset.dragging = ''
  const from = treeWidth() - down.clientX
  const move = (event) => setWidth(from + event.clientX)
  splitter.addEventListener('pointermove', move)
  splitter.addEventListener('pointerup', (up) => {
    splitter.removeEventListener('pointermove', move)
    delete splitter.dataset.dragging
    keepWidth(from + up.clientX)
  }, { once: true })
})
splitter.addEventListener('dblclick', () => {
  panes.style.removeProperty('--tree-width')
  keepWidth(undefined)
})
splitter.addEventListener('keydown', (event) => {
  const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key]
  if (!step) return
  event.preventDefault()
  keepWidth(treeWidth() + (event.shiftKey ? step * 4 : step))
})

// The editor.

const highlighter = await createHighlighter({ themes: Object.values(THEMES), langs: [] })
const themeOf = (scheme) => (scheme === 'dark' ? THEMES.dark : THEMES.light)
const editor = monaco.editor.create(document.getElementById('editor'), {
  model: null,
  automaticLayout: true,
  fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(),
  fontSize: 13,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
})
// shikiToMonaco sets its first theme each time it runs: the scheme's is set again after it.
const highlight = () => {
  shikiToMonaco(highlighter, monaco)
  monaco.editor.setTheme(themeOf(tower.scheme()))
}
highlight()
tower.onScheme((scheme) => monaco.editor.setTheme(themeOf(scheme)))

/** Each file opened, by its absolute path: its model, the version it was read or saved at, and the model's version then. */
const opened = new Map()
let current

const pathEl = document.getElementById('path')
const statusEl = document.getElementById('status')
const saveEl = document.getElementById('save')
const placeholder = document.getElementById('placeholder')

const say = (text, tone = '') => {
  statusEl.textContent = text
  statusEl.dataset.tone = tone
}

const dirty = (file) => file.model.getAlternativeVersionId() !== file.savedAt

const drawHead = () => {
  if (!current) return
  pathEl.textContent = current.path
  pathEl.title = `${current.dir}/${current.path}`
  pathEl.dataset.dirty = String(dirty(current))
  saveEl.disabled = current.readOnly || !dirty(current)
}

const loadLanguage = async (lang) => {
  if (lang === 'text' || highlighter.getLoadedLanguages().includes(lang)) return
  await highlighter.loadLanguage(lang)
  monaco.languages.register({ id: lang })
  highlight()
}

const show = (file) => {
  current = file
  for (const node of document.querySelectorAll('.file[aria-current]')) node.removeAttribute('aria-current')
  document.querySelector(`.file[data-key="${CSS.escape(file.key)}"]`)?.setAttribute('aria-current', 'true')
  placeholder.hidden = Boolean(file.model)
  editor.setModel(file.model ?? null)
  editor.updateOptions({ readOnly: file.readOnly })
  drawHead()
  say(file.note ?? '')
  if (file.model) editor.focus()
}

const openFile = async (dir, path) => {
  const key = `${dir}/${path}`
  if (opened.has(key)) return show(opened.get(key))
  say('Opening…')
  const read = await tower.get(`files/file/${encodeURIComponent(project)}?${new URLSearchParams({ dir, path })}`)
  const file = { key, dir, path, version: read.version, readOnly: Boolean(read.truncated) }
  if (read.binary) {
    placeholder.textContent = `${path} is binary (${read.size} bytes).`
    file.note = 'Binary'
  } else {
    await loadLanguage(read.lang)
    file.model = monaco.editor.createModel(read.text, read.lang, monaco.Uri.file(`${dir}/${path}`))
    file.savedAt = file.model.getAlternativeVersionId()
    file.model.onDidChangeContent(() => file === current && drawHead())
    if (read.truncated) file.note = 'Only its first 1 MB is shown: read-only'
    opened.set(key, file)
  }
  show(file)
}

const save = async () => {
  const file = current
  if (!file?.model || file.readOnly || !dirty(file)) return
  const at = file.model.getAlternativeVersionId()
  say('Saving…')
  try {
    const { version } = await tower.call('files/write', { project, dir: file.dir, path: file.path, text: file.model.getValue(), base: file.version })
    file.version = version
    file.savedAt = at
    say('Saved', 'ok')
  } catch (error) {
    say(error.message, 'broken')
    if (error.code === 'refused') offerReload(file)
  }
  drawHead()
}

/** The file changed on disk: reloading drops the edits, which the user decides. */
const offerReload = (file) => {
  const reload = el('button', 'reload', 'Reload from disk')
  reload.type = 'button'
  reload.addEventListener('click', async () => {
    const read = await tower.get(`files/file/${encodeURIComponent(project)}?${new URLSearchParams({ dir: file.dir, path: file.path })}`)
    file.model.setValue(read.text)
    file.version = read.version
    file.savedAt = file.model.getAlternativeVersionId()
    say('Reloaded')
    drawHead()
  })
  statusEl.append(' ', reload)
}

editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save)
saveEl.addEventListener('click', save)
addEventListener('beforeunload', (event) => {
  if ([...opened.values()].some(dirty)) event.preventDefault()
})

const { roots } = await tower.get(`files/roots/${encodeURIComponent(project)}`)
document.getElementById('files').replaceChildren(...(await Promise.all(roots.map(drawRoot))))
