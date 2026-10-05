/** True when every permission in `needed` is also in `held`. */
export function covers(held: ReadonlySet<string>, needed: Iterable<string>): boolean {
  for (const p of needed) if (!held.has(p)) return false;
  return true;
}

/**
 * Privilege-escalation rule used for every user-management action: you may only grant a role, or manage a
 * person, whose permissions you already hold yourself. So an administrator can never create a super
 * administrator, hand out a role more powerful than their own, or deactivate someone above them.
 */
export function canGrantOrManage(actor: ReadonlySet<string>, target: Iterable<string>): boolean {
  return covers(actor, target);
}
