import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('keeps a plain caller-supplied id', () => {
    expect(resolveRequestId('abc-123_DEF.456')).toBe('abc-123_DEF.456');
  });

  it('takes the first value when the header repeats', () => {
    expect(resolveRequestId(['first-request-id', 'second-request-id'])).toBe('first-request-id');
  });

  it.each(['', 'short', 'has spaces in it', 'line\nbreak-injection', 'x'.repeat(65), '<script>alert(1)</script>'])(
    'replaces the unsafe id %j with a fresh UUID',
    (bad) => {
      const id = resolveRequestId(bad);
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    },
  );

  it('generates a UUID when nothing is supplied', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
