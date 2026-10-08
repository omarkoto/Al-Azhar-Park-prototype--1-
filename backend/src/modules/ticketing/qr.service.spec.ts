import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { AppConfigService } from '../../config/app-config.service';
import { QrService } from './qr.service';

const base = { DATABASE_URL: 'postgresql://u:p@localhost/x', NODE_ENV: 'development' };
const service = (env: Record<string, string> = {}) => new QrService(new AppConfigService({ ...base, ...env }));
const ticket = { publicRef: 'TKT-8F3K2LQ7ZP', qrKeyId: 1 };

/** Reads the QR back from the PNG the way a phone camera would. */
function decode(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

describe('ticket QR code', () => {
  it('encodes a signed payload that decodes from the image and verifies', async () => {
    const qr = service();
    const payload = qr.payloadFor(ticket);
    const decoded = decode(await qr.png(payload));
    expect(decoded).toBe(payload);
    expect(qr.verify(decoded as string)).toEqual({ ok: true, ticketRef: 'TKT-8F3K2LQ7ZP', keyId: 1 });
  });

  it('is deterministic: the same ticket always gives the same code', () => {
    const qr = service();
    expect(qr.payloadFor(ticket)).toBe(qr.payloadFor(ticket));
    expect(qr.payloadFor({ publicRef: 'TKT-ABCDEFGH23', qrKeyId: 1 })).not.toBe(qr.payloadFor(ticket));
  });

  it('holds only the reference, the key id and the signature: no names, e-mail, price or date', () => {
    const payload = service().payloadFor(ticket);
    expect(payload).toMatch(/^AZP1\.TKT-[0-9A-Z]{10}\.1\.[A-Za-z0-9_-]{22}$/);
    expect(payload.length).toBeLessThan(48);
  });

  it('scans reliably: a large image with error correction level Q and a quiet zone', async () => {
    const qr = service();
    const png = PNG.sync.read(await qr.png(qr.payloadFor(ticket), 600));
    expect(png.width).toBeGreaterThanOrEqual(600);
    // the quiet zone: the outer rows are blank
    for (let x = 0; x < png.width; x += 7) expect(png.data[(x * 4)]).toBe(255);
    // a damaged code (a blotch over a corner of the data area) still reads, thanks to error correction
    const blotch = PNG.sync.read(await qr.png(qr.payloadFor(ticket), 600));
    for (let y = 300; y < 330; y += 1) for (let x = 300; x < 330; x += 1) blotch.data.fill(0, (y * blotch.width + x) * 4, (y * blotch.width + x) * 4 + 3);
    expect(decode(PNG.sync.write(blotch))).toBe(qr.payloadFor(ticket));
  });

  it('refuses every kind of tampering', () => {
    const qr = service();
    const payload = qr.payloadFor(ticket);
    const [v, ref, key, sig] = payload.split('.');
    const flip = (s: string) => s.slice(0, -2) + (s.endsWith('A') ? 'B' : 'A') + s.slice(-1);
    const cases: Array<[string, string]> = [
      ['another ticket reference, same signature', `${v}.TKT-ABCDEFGH23.${key}.${sig}`],
      ['a changed reference character', `${v}.${ref.replace('8', '9')}.${key}.${sig}`],
      ['a changed signature', `${v}.${ref}.${key}.${flip(sig)}`],
      ['a truncated signature', `${v}.${ref}.${key}.${sig.slice(0, 21)}`],
      ['an extended signature', `${v}.${ref}.${key}.${sig}A`],
      ['a different key id', `${v}.${ref}.2.${sig}`],
      ['a different version', `AZP2.${ref}.${key}.${sig}`],
      ['an extra field (a date)', `${v}.${ref}.${key}.${sig}.2026-10-09`],
      ['lower-case', payload.toLowerCase()],
      ['padding', `${payload}=`],
      ['whitespace', ` ${payload}`],
      ['an empty string', ''],
      ['garbage', 'hello world'],
      ['a huge string', 'A'.repeat(100_000)],
    ];
    for (const [label, bad] of cases) expect({ label, ok: qr.verify(bad).ok }).toEqual({ label, ok: false });
  });

  it('reports why a code is refused without touching the database', () => {
    const qr = service();
    const [v, ref, , sig] = qr.payloadFor(ticket).split('.');
    expect(qr.verify('nonsense')).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(qr.verify(`${v}.${ref}.5.${sig}`)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    expect(qr.verify(`${v}.${ref}.1.${'A'.repeat(22)}`)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('a code signed by one deployment does not verify on another', () => {
    const a = service({ TICKET_TOKEN_PEPPER: 'a'.repeat(40) });
    const b = service({ TICKET_TOKEN_PEPPER: 'b'.repeat(40) });
    expect(b.verify(a.payloadFor(ticket)).ok).toBe(false);
  });

  describe('key rotation', () => {
    const keys = JSON.stringify({ 1: 'o'.repeat(40), 2: 'n'.repeat(40) });
    it('old tickets keep verifying after the active key changes, and new tickets use the new key', () => {
      const before = service({ TICKET_QR_KEYS: keys, TICKET_QR_ACTIVE_KEY_ID: '1' });
      const after = service({ TICKET_QR_KEYS: keys, TICKET_QR_ACTIVE_KEY_ID: '2' });
      const old = before.payloadFor({ publicRef: ticket.publicRef, qrKeyId: 1 });
      expect(after.verify(old)).toMatchObject({ ok: true, keyId: 1 });
      const fresh = after.payloadFor({ publicRef: ticket.publicRef, qrKeyId: 2 });
      expect(after.verify(fresh)).toMatchObject({ ok: true, keyId: 2 });
      expect(old).not.toBe(fresh);
    });
    it('a retired key stops verifying once it is removed from the ring', () => {
      const old = service({ TICKET_QR_KEYS: keys }).payloadFor({ publicRef: ticket.publicRef, qrKeyId: 1 });
      const retired = service({ TICKET_QR_KEYS: JSON.stringify({ 2: 'n'.repeat(40) }), TICKET_QR_ACTIVE_KEY_ID: '2' });
      expect(retired.verify(old)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    });
    it('cannot sign with a key that is not configured', () => {
      expect(() => service().payloadFor({ publicRef: ticket.publicRef, qrKeyId: 7 })).toThrow(/No QR signing key/);
    });
  });
});
