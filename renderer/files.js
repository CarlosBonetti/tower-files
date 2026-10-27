// The "All files" pane: a renderer framed on a floor's shelf, drawing `files/tree/<project>` as a folding tree.
const { settings } = await tower.renderer()
const project = settings.project
document.getElementById('floor').textContent = project

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

const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

/** Folders first, then files, each in name order. */
const entries = (folder) =>
  [...folder].sort(([a, av], [b, bv]) => (av === null) - (bv === null) || a.localeCompare(b))

const drawFolder = (folder) => {
  const list = el('ul', 'tree')
  for (const [name, inner] of entries(folder)) {
    const item = el('li')
    if (inner === null) item.append(el('span', 'file', name))
    else {
      const details = el('details')
      details.append(el('summary', 'folder', name))
      details.addEventListener('toggle', () => {
        if (details.open && details.childElementCount === 1) details.append(drawFolder(inner))
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
  head.append(el('small', undefined, ` ${dir} · ${files.length} files`))
  section.append(head)
  section.append(error ? el('p', 'note', error) : drawFolder(nest(files)))
  return section
}

const main = document.getElementById('files')
const { roots } = await tower.get(`files/tree/${encodeURIComponent(project)}`)
main.replaceChildren(...roots.map(drawRoot))
