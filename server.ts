/**
 * The files extension: `roots/<project>` names a floor's directories, its hub and repos; `entries/<project>` lists a
 * folder of one, everything in it, marking what git ignores, so a tree loads a folder when it is opened, however big
 * (node_modules too); `file/<project>` reads a file with the Shiki grammar its name calls for, and `write` saves one
 * over the version it was read at.
 */
import { open, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bundledLanguagesInfo } from 'shiki'

type Floor = { id: string; hub: string; repos: string[] }
type Refusal = { t: 'error'; code: string; message: string }
type Entry = { name: string; kind: 'dir' | 'file'; ignored?: true }

const SEND_BYTES = 1024 * 1024

/** What a folder is listed without, as VS Code's explorer hides them. */
const HIDDEN = new Set(['.git', '.DS_Store'])

/** Grammars by what names a file: its extension or alias (`ts`, `yml`) and its whole name (`Dockerfile`). */
const LANGS = new Map<string, string>()
for (const { id, aliases } of bundledLanguagesInfo) for (const name of [id, ...(aliases ?? [])]) LANGS.set(name.toLowerCase(), id)
for (const [name, id] of Object.entries({ dockerfile: 'docker', makefile: 'make', license: 'text', mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts', jsonl: 'json' })) LANGS.set(name, LANGS.get(id) ?? id)

const langOf = (file: string): string => {
  const base = path.basename(file).toLowerCase()
  return LANGS.get(base) ?? LANGS.get(path.extname(base).slice(1)) ?? 'text'
}

/** The paths of `paths` (relative to `dir`, a folder's with a trailing slash) git ignores; none outside a repo. */
const ignoredOf = async (ctx: any, dir: string, paths: string[]): Promise<Set<string>> => {
  if (!paths.length) return new Set()
  const ran = await ctx.run(['git', 'check-ignore', '-z', '--stdin'], { cwd: dir, stdin: paths.join('\0') + '\0' })
  return new Set(ran.exit === 0 ? ran.stdout.split('\0').filter(Boolean) : [])
}

/** A folder's entries, a link taken as the kind it points at. */
const entriesOf = async (ctx: any, dir: string, folder: string, rel: string): Promise<Entry[]> => {
  const dirents = (await readdir(folder, { withFileTypes: true })).filter((dirent) => !HIDDEN.has(dirent.name))
  const kinds = await Promise.all(dirents.map(async (dirent): Promise<Entry['kind']> => {
    if (!dirent.isSymbolicLink()) return dirent.isDirectory() ? 'dir' : 'file'
    const target = await stat(path.join(folder, dirent.name)).catch(() => undefined)
    return target?.isDirectory() ? 'dir' : 'file'
  }))
  const pathOf = (name: string, kind: Entry['kind']) => (rel ? `${rel}/` : '') + name + (kind === 'dir' ? '/' : '')
  const ignored = await ignoredOf(ctx, dir, dirents.map((dirent, i) => pathOf(dirent.name, kinds[i])))
  return dirents
    .map((dirent, i): Entry => ({ name: dirent.name, kind: kinds[i], ...(ignored.has(pathOf(dirent.name, kinds[i])) && { ignored: true as const }) }))
    .sort((a, b) => (a.kind === 'file' ? 1 : 0) - (b.kind === 'file' ? 1 : 0) || a.name.localeCompare(b.name))
}

const floorOf = (ctx: any, project: string): Floor | Refusal =>
  ctx.board().floors.find((f: Floor) => f.id === project) ?? { t: 'error', code: 'not_found', message: `no floor ${project}` }

/** The absolute path of `file` in `dir`, one of the floor's directories, or why not. */
const placed = (floor: Floor, dir: string, file: string): string | Refusal => {
  if (![floor.hub, ...floor.repos].includes(dir)) return { t: 'error', code: 'invalid', message: `${dir} is not a directory of ${floor.id}` }
  const full = path.resolve(dir, file)
  const rel = path.relative(dir, full)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { t: 'error', code: 'invalid', message: `${file} is outside ${dir}` }
  return full
}

const start = (ctx: any) => ({
  verbs: {
    write: async ({ project, dir, path: file, text, base }: { project: string; dir: string; path: string; text: string; base: number }) => {
      const floor = floorOf(ctx, project)
      if ('t' in floor) return floor
      const full = placed(floor, dir, file)
      if (typeof full !== 'string') return full
      const now = await stat(full).catch(() => undefined)
      if (!now) return { t: 'error', code: 'not_found', message: `no file ${file} in ${dir}` }
      if (now.mtimeMs !== base) return { t: 'error', code: 'refused', message: `${file} changed on disk since it was read` }
      await writeFile(full, text)
      const { size, mtimeMs } = await stat(full)
      return { size, version: mtimeMs }
    },
  },
  reads: {
    'roots/<project>': ({ params }: { params: { project: string } }) => {
      const floor = floorOf(ctx, params.project)
      if ('t' in floor) return floor
      return { project: params.project, roots: [floor.hub, ...floor.repos] }
    },
    'entries/<project>': async ({ params, query }: { params: { project: string }; query: { dir: string; path?: string } }) => {
      const floor = floorOf(ctx, params.project)
      if ('t' in floor) return floor
      const rel = query.path ?? ''
      const full = placed(floor, query.dir, rel)
      if (typeof full !== 'string') return full
      const entries = await entriesOf(ctx, query.dir, full, rel).catch(() => undefined)
      if (!entries) return { t: 'error', code: 'not_found', message: `no folder ${rel || '.'} in ${query.dir}` }
      return { dir: query.dir, path: rel, entries }
    },
    'file/<project>': async ({ params, query }: { params: { project: string }; query: { dir: string; path: string } }) => {
      const floor = floorOf(ctx, params.project)
      if ('t' in floor) return floor
      const full = placed(floor, query.dir, query.path)
      if (typeof full !== 'string') return full
      const file = await open(full).catch(() => undefined)
      if (!file) return { t: 'error', code: 'not_found', message: `no file ${query.path} in ${query.dir}` }
      try {
        const { size, mtimeMs } = await file.stat()
        const buf = Buffer.alloc(Math.min(size, SEND_BYTES))
        await file.read(buf, 0, buf.length, 0)
        const reply = { dir: query.dir, path: query.path, size, version: mtimeMs, lang: langOf(full), ...(size > SEND_BYTES && { truncated: true }) }
        return buf.includes(0) ? { ...reply, binary: true } : { ...reply, text: buf.toString('utf8') }
      } finally {
        await file.close()
      }
    },
  },
})

export default start
