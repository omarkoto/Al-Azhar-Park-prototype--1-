import { passwordProblem } from './password-policy';

describe('password policy', () => {
  it('accepts a long, unremarkable password', () => {
    expect(passwordProblem('correct horse battery staple')).toBeNull();
    expect(passwordProblem('Tr0ub4dor&3-extended')).toBeNull();
  });
  it('rejects short, huge, padded, common and repetitive passwords', () => {
    expect(passwordProblem('Short1!')).toMatch(/at least 12/);
    expect(passwordProblem('x'.repeat(129))).toMatch(/at most 128/);
    expect(passwordProblem(' leading-space-pass')).toMatch(/space/);
    expect(passwordProblem('Password1234')).toMatch(/common/);
    expect(passwordProblem('aaaaaaaaaaaaaaaa')).toMatch(/repetitive/);
  });
  it('rejects passwords containing the email name or the person name', () => {
    expect(passwordProblem('Mahmoud-2026-secret', { email: 'mahmoud@x.test' })).toMatch(/email/);
    expect(passwordProblem('hello-Hassan-2026!', { fullName: 'Omar Hassan' })).toMatch(/name/);
  });
  it('does not reject on short name fragments', () => {
    expect(passwordProblem('some-long-passphrase-here', { email: 'ab@x.test', fullName: 'Al Bo' })).toBeNull();
  });
});
