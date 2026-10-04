const modules = import.meta.glob('../assets/images/*', { eager: true, import: 'default' }) as Record<string, string>

const byBasename: Record<string, string> = {}
for (const [path, url] of Object.entries(modules)) {
  const basename = path.split('/').pop()
  if (basename) byBasename[basename] = url
}

export function resolveImage(pathOrName: string): string {
  const basename = pathOrName.split('/').pop() ?? pathOrName
  return byBasename[basename] ?? pathOrName
}
