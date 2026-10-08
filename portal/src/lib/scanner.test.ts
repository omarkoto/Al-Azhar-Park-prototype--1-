import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import {
  CAMERA_MESSAGE, cameraStateFor, decodeFrame, failureMessage, isRepeat, normalizeCode, resultView, scanReducer, type ScanCode, type ScanOutcome, type ScanScreen,
} from './scanner'

const CODES: ScanCode[] = ['ACCESS_GRANTED', 'INVALID_QR', 'INVALID_SIGNATURE', 'RETIRED_KEY', 'TICKET_NOT_FOUND', 'TICKET_NOT_VALID', 'ALREADY_USED', 'WRONG_DATE', 'CANCELLED', 'EXPIRED']
const gate = { id: 'g1', code: 'MAIN', nameEn: 'Main entrance', nameAr: 'المدخل الرئيسي' }
const outcome = (result: ScanCode, over: Partial<ScanOutcome> = {}): ScanOutcome => ({
  result, granted: result === 'ACCESS_GRANTED', message: '', scanId: 's1', scannedAt: '2026-10-07T10:00:00Z', gate,
  ticket: { ref: 'TKT-8F3K2LQ7ZP', visitDate: '2026-10-07', typeNameEn: 'Adult', typeNameAr: 'بالغ', audienceNameEn: 'Egyptian / resident', audienceNameAr: 'مصري' }, ...over,
})

describe('what the operator sees', () => {
  it('grants in green with one clear headline, and every other result is a denial', () => {
    expect(resultView({ result: 'ACCESS_GRANTED' })).toMatchObject({ headline: 'ACCESS GRANTED', tone: 'granted' });
    for (const code of CODES.filter((c) => c !== 'ACCESS_GRANTED')) expect(resultView({ result: code }).tone).toBe('denied')
  })

  it('names the reason in capital letters an operator can read from a distance', () => {
    const headline = (c: ScanCode) => resultView({ result: c }).headline
    expect(headline('ALREADY_USED')).toBe('TICKET ALREADY USED')
    expect(headline('WRONG_DATE')).toBe('WRONG VISIT DATE')
    expect(headline('CANCELLED')).toBe('TICKET CANCELLED')
    expect(headline('EXPIRED')).toBe('TICKET EXPIRED')
    expect(headline('TICKET_NOT_FOUND')).toBe('TICKET NOT FOUND')
    expect(headline('INVALID_QR')).toBe('INVALID TICKET')
    expect(headline('INVALID_SIGNATURE')).toBe('INVALID TICKET')
    expect(new Set(CODES.map(headline)).size).toBeGreaterThanOrEqual(8)
  })

  it('shows the visit date on a wrong-date denial', () => {
    expect(resultView({ result: 'WRONG_DATE', ticket: outcome('WRONG_DATE').ticket }).detail).toContain('2026-10-07')
    expect(resultView({ result: 'WRONG_DATE' }).detail).toMatch(/not for today/)
  })

  it('does not reveal how codes are checked, whatever the result', () => {
    for (const code of CODES) expect(JSON.stringify(resultView({ result: code })).toLowerCase()).not.toMatch(/hmac|sha|secret|signature|key id|database|sql/)
    expect(resultView({ result: 'INVALID_QR' })).toEqual(resultView({ result: 'INVALID_SIGNATURE' }))
  })
})

describe('the scanned text', () => {
  it('is cleaned of line ends and stray spaces, and refused when empty or huge', () => {
    expect(normalizeCode('  AZP1.TKT-8F3K2LQ7ZP.1.abc \r\n')).toBe('AZP1.TKT-8F3K2LQ7ZP.1.abc')
    expect(normalizeCode('AZP1.TKT\n-8F3K')).toBe('AZP1.TKT-8F3K')
    expect(normalizeCode('   ')).toBeNull()
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode('A'.repeat(513))).toBeNull()
    expect(normalizeCode('A'.repeat(512))).not.toBeNull()
  })

  it('is not changed in any other way (the server compares it exactly)', () => {
    expect(normalizeCode('AZP1.tkt-abc.1.XyZ')).toBe('AZP1.tkt-abc.1.XyZ')
  })

  it('ignores the same code for a few seconds after it was answered, but not a different one', () => {
    const last = { code: 'A', at: 10_000 }
    expect(isRepeat('A', last, 12_000)).toBe(true)
    expect(isRepeat('A', last, 14_000)).toBe(false)
    expect(isRepeat('B', last, 10_500)).toBe(false)
    expect(isRepeat('A', null, 10_500)).toBe(false)
  })
})

describe('camera problems', () => {
  it('tells a refusal from a missing camera from anything else', () => {
    expect(cameraStateFor({ name: 'NotAllowedError' })).toBe('denied')
    expect(cameraStateFor({ name: 'SecurityError' })).toBe('denied')
    expect(cameraStateFor({ name: 'NotFoundError' })).toBe('none')
    expect(cameraStateFor({ name: 'NotReadableError' })).toBe('error')
    expect(cameraStateFor(null)).toBe('error')
  })
  it('every problem points to the manual entry', () => {
    for (const message of Object.values(CAMERA_MESSAGE)) expect(message.toLowerCase()).toMatch(/type|handheld/)
  })
})

describe('one scan at a time', () => {
  const ready: ScanScreen = { phase: 'ready' }
  it('goes ready → checking → result → ready', () => {
    const checking = scanReducer(ready, { type: 'submit', code: 'X' })
    expect(checking).toEqual({ phase: 'checking', code: 'X' })
    const shown = scanReducer(checking, { type: 'answered', outcome: outcome('ACCESS_GRANTED') })
    expect(shown.phase).toBe('result')
    expect(scanReducer(shown, { type: 'next' })).toEqual(ready)
  })
  it('accepts no second code while one is being checked or a result is on screen', () => {
    const checking = scanReducer(ready, { type: 'submit', code: 'X' })
    expect(scanReducer(checking, { type: 'submit', code: 'Y' })).toBe(checking)
    const shown = scanReducer(checking, { type: 'answered', outcome: outcome('ALREADY_USED') })
    expect(scanReducer(shown, { type: 'submit', code: 'Y' })).toBe(shown)
  })
  it('ignores an answer nobody is waiting for', () => {
    expect(scanReducer(ready, { type: 'answered', outcome: outcome('ACCESS_GRANTED') })).toBe(ready)
    expect(scanReducer(ready, { type: 'failed', message: 'x', gateProblem: false })).toBe(ready)
  })
  it('recovers from a failure without reloading: retry the same code, or move on', () => {
    const failed = scanReducer(scanReducer(ready, { type: 'submit', code: 'X' }), { type: 'failed', message: 'offline', gateProblem: false })
    expect(failed).toEqual({ phase: 'failed', code: 'X', message: 'offline', gateProblem: false })
    expect(scanReducer(failed, { type: 'submit', code: 'X' })).toEqual({ phase: 'checking', code: 'X' })
    expect(scanReducer(failed, { type: 'next' })).toEqual(ready)
  })
})

describe('when the check itself fails', () => {
  it('never claims the ticket was refused: the result is unknown', () => {
    const m = failureMessage(new TypeError('Failed to fetch')).message
    expect(m).toMatch(/not known/)
    expect(m).toMatch(/already let in/)
  })
  it('sends the operator back to choose a gate when the gate is gone', () => {
    for (const code of ['GATE_NOT_FOUND', 'GATE_INACTIVE']) expect(failureMessage(new ApiError(422, code, 'x'))).toMatchObject({ gateProblem: true })
  })
  it('says what to do about a rate limit or a missing permission', () => {
    expect(failureMessage(new ApiError(429, 'RATE_LIMITED', 'x')).message).toMatch(/Wait/)
    expect(failureMessage(new ApiError(403, 'FORBIDDEN', 'x')).message).toMatch(/not allowed/)
    expect(failureMessage(new ApiError(401, 'UNAUTHENTICATED', 'x')).message).toMatch(/Sign in/)
  })
})

describe('reading a camera frame', () => {
  /** Draws a QR code into RGBA pixels the way a camera frame arrives. */
  function frame(text: string, scale = 8, margin = 4, invert = false) {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'Q' })
    const size = qr.modules.size
    const side = (size + margin * 2) * scale
    const data = new Uint8ClampedArray(side * side * 4)
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        const row = Math.floor(y / scale) - margin
        const col = Math.floor(x / scale) - margin
        const dark = row >= 0 && col >= 0 && row < size && col < size && qr.modules.get(row, col)
        const v = (dark ? 0 : 255) ^ (invert ? 255 : 0)
        const i = (y * side + x) * 4
        data[i] = data[i + 1] = data[i + 2] = v
        data[i + 3] = 255
      }
    }
    return { data, side }
  }

  it('reads the text of a ticket QR code', () => {
    const payload = 'AZP1.TKT-8F3K2LQ7ZP.1.q3xB9mTzK1hY7wPcA0nRdg'
    const { data, side } = frame(payload)
    expect(decodeFrame(data, side, side)).toBe(payload)
  })

  it('reads a small, distant code', () => {
    const payload = 'AZP1.TKT-8F3K2LQ7ZP.1.q3xB9mTzK1hY7wPcA0nRdg'
    const { data, side } = frame(payload, 3)
    expect(decodeFrame(data, side, side)).toBe(payload)
  })

  it('returns nothing for a blank frame or noise', () => {
    expect(decodeFrame(new Uint8ClampedArray(200 * 200 * 4).fill(255), 200, 200)).toBeNull()
    const noise = new Uint8ClampedArray(200 * 200 * 4)
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) % 256
    expect(decodeFrame(noise, 200, 200)).toBeNull()
  })

  it('hands the text over untouched: the browser decides nothing about it', () => {
    const odd = "AZP1.TKT-XXXX.1.' OR 1=1 --"
    const { data, side } = frame(odd)
    expect(decodeFrame(data, side, side)).toBe(odd)
  })
})
