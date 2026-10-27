/**
 * The files extension: `tree/<project>` lists the files of a floor's hub and repos, each as git sees it (tracked,
 * and untracked but not ignored) or, outside git, every file but those under `.git` and `node_modules`, so a renderer or a worker reads one floor's files in one call; `file/<project>`
 * reads one of them with the Shiki grammar its name calls for, and `write` saves one over the version it was read at.
 */
import { open, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { bundledLanguagesInfo } from 'shiki'

type Root = { dir: string; files: string[]; error?: string }
type Floor = { id: string; hub: string; repos: string[] }
type Refusal = { t: 'error'; code: string; message: string }

const SEND_BYTES = 1024 * 1024

/** Grammars by what names a file: its extension or alias (`ts`, `yml`) and its whole name (`Dockerfile`). */
const LANGS = new Map<string, string>()
for (const { id, aliases } of bundledLanguagesInfo) for (const name of [id, ...(aliases ?? [])]) LANGS.set(name.toLowerCase(), id)
for (const [name, id] of Object.entries({ dockerfile: 'docker', makefile: 'make', '.gitignore': 'ignore', license: 'text', mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts', jsonl: 'json' })) LANGS.set(name, id)

const langOf = (file: string): string => {
  const base = path.basename(file).toLowerCase()
  return LANGS.get(base) ?? LANGS.get(path.extname(base).slice(1)) ?? 'text'
}

/** Folders a directory that isn't a git repo is listed without. */
const SKIPPED = new Set(['.git', 'node_modules'])

/** Every file below `dir` but those in SKIPPED folders, relative to it. */
const walked = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .filter((file) => !file.split(path.sep).some((part) => SKIPPED.has(part)))
}

/** A git repo's files as git sees them; any other directory's walked. */
const listed = async (ctx: any, dir: string): Promise<Root> => {
  const ran = await ctx.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: dir })
  if (ran.exit !== 0 && !ran.stderr.includes('not a git repository')) return { dir, files: [], error: ran.stderr.trim() || `git ls-files exited ${ran.exit}` }
  const files = ran.exit === 0 ? ran.stdout.split('\0').filter(Boolean) : await walked(dir)
  return { dir, files: [...new Set(files)].sort() }
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
    'tree/<project>': async ({ params }: { params: { project: string } }) => {
      const floor = floorOf(ctx, params.project)
      if ('t' in floor) return floor
      const roots = await Promise.all([floor.hub, ...floor.repos].map((dir) => listed(ctx, dir)))
      return { project: params.project, roots }
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
