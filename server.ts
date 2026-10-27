/**
 * The files extension: `tree/<project>` lists the files of a floor's hub and repos, each as git sees it (tracked,
 * and untracked but not ignored), so a renderer or a worker reads one floor's files in one call.
 */

type Root = { dir: string; files: string[]; error?: string }

const listed = async (ctx: any, dir: string): Promise<Root> => {
  const ran = await ctx.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: dir })
  if (ran.exit !== 0) return { dir, files: [], error: ran.stderr.trim() || `git ls-files exited ${ran.exit}` }
  const files = [...new Set<string>(ran.stdout.split('\0').filter(Boolean))].sort()
  return { dir, files }
}

const start = (ctx: any) => ({
  reads: {
    'tree/<project>': async ({ params }: { params: { project: string } }) => {
      const floor = ctx.board().floors.find((f: { id: string }) => f.id === params.project)
      if (!floor) return { t: 'error', code: 'not_found', message: `no floor ${params.project}` }
      const roots = await Promise.all([floor.hub, ...floor.repos].map((dir: string) => listed(ctx, dir)))
      return { project: params.project, roots }
    },
  },
})

export default start
