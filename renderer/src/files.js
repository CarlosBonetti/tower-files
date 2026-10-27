// The "All files" pane: a renderer framed on a floor's shelf. The floor's files as a folding tree
// (`files/tree/<project>`), and the one picked open in Monaco, VS Code's editor, highlighted by Shiki with VS Code's
// TextMate grammars and Light+ / Dark+ themes; Cmd/Ctrl+S saves it through `files/write`.
import { shikiToMonaco } from '@shikijs/monaco'
import { createHighlighter } from 'shiki'
import * as monaco from './monaco.js'

const THEMES = { light: 'light-plus', dark: 'dark-plus' }

const { settings } = await tower.renderer()
const project = settings.project
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

// The tree.

/** Nests a root's paths: a folder is a Map of its entries, a file null. */
const nest = (files) => {
  const top = new Map()
  for (const path of files) {
    const parts = path.split('/')
    let at = top
    for (const part of parts.slice(0, -1)) {
      if (!at.has(part)) at.set(part, new Map())
      at = at.get(part)
    }
    at.set(parts.at(-1), null)
  }
  return top
}

/** Folders first, then files, each in name order. */
const entries = (folder) =>
  [...folder].sort(([a, av], [b, bv]) => (av === null) - (bv === null) || a.localeCompare(b))

const drawFolder = (dir, folder, prefix) => {
  const list = el('ul', 'tree')
  for (const [name, inner] of entries(folder)) {
    const item = el('li')
    const path = prefix + name
    if (inner === null) {
      const file = el('button', 'file', name)
      file.type = 'button'
      file.dataset.key = `${dir}/${path}`
      file.addEventListener('click', () => openFile(dir, path))
      item.append(file)
    } else {
      const details = el('details')
      details.append(el('summary', 'folder', name))
      details.addEventListener('toggle', () => {
        if (details.open && details.childElementCount === 1) details.append(drawFolder(dir, inner, `${path}/`))
      }, { once: true })
      item.append(details)
    }
    list.append(item)
  }
  return list
}

const drawRoot = ({ dir, files, error }) => {
  const section = el('section', 'root')
  const head = el('h2', undefined, dir.split('/').at(-1))
  head.title = dir
  head.append(el('small', undefined, ` ${files.length} files`))
  section.append(head)
  section.append(error ? el('p', 'note', error) : drawFolder(dir, nest(files), ''))
  return section
}

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

const { roots } = await tower.get(`files/tree/${encodeURIComponent(project)}`)
document.getElementById('files').replaceChildren(...roots.map(drawRoot))
