import { randomBytes } from 'node:crypto';
import { generateTicketRef } from '../../modules/ticketing/rules/references';
import { createQrPayload, qrFingerprint, verifyQrPayload } from './ticket-qr';

const SECRET_1 = 'k1-0123456789abcdef0123456789abcdef-secret';
const SECRET_2 = 'k2-fedcba9876543210fedcba9876543210-secret';
const keys = { 1: SECRET_1 } as const;
const REF = 'TKT-8F3K2LQ7ZP';

describe('ticket QR payload', () => {
  it('round-trips: what the server signs, the server verifies', () => {
    const payload = createQrPayload(REF, 1, SECRET_1);
    expect(verifyQrPayload(payload, keys)).toEqual({ ok: true, ticketRef: REF, keyId: 1 });
  });

  it('has the documented shape and a 128-bit signature', () => {
    const payload = createQrPayload(REF, 1, SECRET_1);
    expect(payload).toMatch(/^AZP1\.TKT-8F3K2LQ7ZP\.1\.[A-Za-z0-9_-]{22}$/);
    expect(payload.length).toBeLessThanOrEqual(64);
  });

  it('is derivable again from the reference alone (so the QR can always be re-displayed)', () => {
    expect(createQrPayload(REF, 1, SECRET_1)).toBe(createQrPayload(REF, 1, SECRET_1));
  });

  it('contains nothing but the reference, key id and signature — no personal data', () => {
    const payload = createQrPayload(REF, 1, SECRET_1);
    const [version, ref, kid, sig, ...rest] = payload.split('.');
    expect(rest).toHaveLength(0);
    expect([version, ref]).toEqual(['AZP1', REF]);
    expect(kid).toMatch(/^\d+$/);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  describe('forgery and tampering', () => {
    const good = createQrPayload(REF, 1, SECRET_1);

    it('rejects a different ticket reference with the original signature', () => {
      const forged = good.replace('TKT-8F3K2LQ7ZP', 'TKT-8F3K2LQ7ZQ');
      expect(verifyQrPayload(forged, keys)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    });

    it('rejects a signature made with the wrong key', () => {
      expect(verifyQrPayload(createQrPayload(REF, 1, SECRET_2), keys)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    });

    it('rejects every single-character change of the signature (1,000 random mutations)', () => {
      const [prefix, last] = [good.slice(0, good.lastIndexOf('.') + 1), good.slice(good.lastIndexOf('.') + 1)];
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      for (let i = 0; i < 1000; i++) {
        const pos = randomBytes(1)[0] % last.length;
        let ch = alphabet[randomBytes(1)[0] % alphabet.length];
        if (ch === last[pos]) ch = ch === 'A' ? 'B' : 'A';
        const mutated = prefix + last.slice(0, pos) + ch + last.slice(pos + 1);
        // every spelling other than the canonical one is refused — including the "unused bits" of the last character
        expect(verifyQrPayload(mutated, keys)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
      }
    });

    it('accepts exactly one spelling of a signature (no malleability)', () => {
      const lastChar = good.at(-1) as string;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let accepted = 0;
      for (const ch of alphabet) if (verifyQrPayload(good.slice(0, -1) + ch, keys).ok) accepted++;
      expect(accepted).toBe(1);
      expect(verifyQrPayload(good, keys).ok).toBe(true);
      expect(alphabet).toContain(lastChar);
    });

    it('cannot be re-labelled with another key id', () => {
      const asKey2 = good.replace(/\.1\./, '.2.');
      expect(verifyQrPayload(asKey2, { 1: SECRET_1, 2: SECRET_2 })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
      expect(verifyQrPayload(asKey2, keys)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    });

    it.each([
      ['empty', ''],
      ['no prefix', 'TKT-8F3K2LQ7ZP'],
      ['wrong version', good.replace('AZP1', 'AZP2')],
      ['lower-case reference', good.replace('TKT-8F3K2LQ7ZP', 'tkt-8f3k2lq7zp')],
      ['missing signature', good.split('.').slice(0, 3).join('.')],
      ['extra segment', `${good}.extra`],
      ['whitespace', ` ${good}`],
      ['newline', `${good}\n`],
      ['signature too short', good.slice(0, -1)],
      ['oversized', 'AZP1.' + 'A'.repeat(5000)],
      ['SQL-ish text', "AZP1.TKT-8F3K2LQ7ZP.1.' OR 1=1 --"],
      ['URL', 'https://example.com/ticket/TKT-8F3K2LQ7ZP'],
    ])('rejects %s as malformed before any database or crypto work', (_label, payload) => {
      expect(verifyQrPayload(payload, keys)).toEqual({ ok: false, reason: 'MALFORMED' });
    });

    it('does not trust prototype keys as key ids', () => {
      expect(verifyQrPayload(good.replace('.1.', '.999.'), keys)).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    });
  });

  describe('key rotation', () => {
    it('keeps old tickets working while new tickets use the new key', () => {
      const ring = { 1: SECRET_1, 2: SECRET_2 };
      const old = createQrPayload(REF, 1, SECRET_1);
      const fresh = createQrPayload(REF, 2, SECRET_2);
      expect(verifyQrPayload(old, ring)).toMatchObject({ ok: true, keyId: 1 });
      expect(verifyQrPayload(fresh, ring)).toMatchObject({ ok: true, keyId: 2 });
    });

    it('stops accepting a retired key once it is removed from the ring', () => {
      expect(verifyQrPayload(createQrPayload(REF, 1, SECRET_1), { 2: SECRET_2 })).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    });
  });

  describe('issuing', () => {
    it('refuses a weak signing secret', () => {
      expect(() => createQrPayload(REF, 1, 'short')).toThrow(/at least 32/);
    });

    it('refuses an invalid reference or key id', () => {
      expect(() => createQrPayload('not-a-ref', 1, SECRET_1)).toThrow();
      expect(() => createQrPayload(REF, -1, SECRET_1)).toThrow();
      expect(() => createQrPayload(REF, 1000, SECRET_1)).toThrow();
    });

    it('signs generated references without error', () => {
      for (let i = 0; i < 200; i++) {
        const ref = generateTicketRef();
        expect(verifyQrPayload(createQrPayload(ref, 1, SECRET_1), keys)).toMatchObject({ ok: true, ticketRef: ref });
      }
    });
  });

  describe('logging', () => {
    it('gives a short non-reversible fingerprint that is not part of the code', () => {
      const payload = createQrPayload(REF, 1, SECRET_1);
      const fp = qrFingerprint(payload);
      expect(fp).toMatch(/^[0-9a-f]{12}$/);
      expect(payload).not.toContain(fp);
      expect(qrFingerprint(payload)).toBe(fp);
      expect(qrFingerprint(payload + 'x')).not.toBe(fp);
    });
  });
});
