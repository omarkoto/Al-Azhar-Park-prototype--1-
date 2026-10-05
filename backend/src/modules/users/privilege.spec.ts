import { canGrantOrManage, covers } from './privilege';

describe('privilege escalation rule', () => {
  const admin = new Set(['users:read', 'users:write', 'pricing:write']);
  it('allows granting what you hold', () => {
    expect(canGrantOrManage(admin, ['users:read', 'pricing:write'])).toBe(true);
    expect(covers(admin, [])).toBe(true);
  });
  it('refuses anything beyond what you hold', () => {
    expect(canGrantOrManage(admin, ['users:read', 'roles:write'])).toBe(false);
    expect(canGrantOrManage(new Set(), ['users:read'])).toBe(false);
  });
});
