export interface PermissionInfo {
  code: string
  description: string | null
}

export interface PermissionGroup {
  resource: string
  items: Array<{ code: string; action: string; description: string }>
}

/**
 * Groups the permission catalogue FROM THE BACKEND by resource ("tickets:read" → resource "tickets").
 * Nothing about the permissions is hard-coded here, so a permission added to the backend appears automatically.
 */
export function groupPermissions(catalogue: PermissionInfo[]): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>()
  for (const p of catalogue) {
    const [resource, action = ''] = p.code.split(':')
    const g = groups.get(resource) ?? { resource, items: [] }
    g.items.push({ code: p.code, action, description: p.description ?? '' })
    groups.set(resource, g)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.action.localeCompare(b.action)) }))
    .sort((a, b) => a.resource.localeCompare(b.resource))
}

export function diffPermissions(before: readonly string[], after: readonly string[]) {
  const b = new Set(before)
  const a = new Set(after)
  return {
    added: [...a].filter((c) => !b.has(c)).sort(),
    removed: [...b].filter((c) => !a.has(c)).sort(),
  }
}

export function sameSet(x: readonly string[], y: readonly string[]): boolean {
  const d = diffPermissions(x, y)
  return d.added.length === 0 && d.removed.length === 0
}

/** Adds or removes every permission of a group at once. */
export function toggleGroup(selected: ReadonlySet<string>, group: PermissionGroup, on: boolean): Set<string> {
  const next = new Set(selected)
  for (const item of group.items) {
    if (on) next.add(item.code)
    else next.delete(item.code)
  }
  return next
}
