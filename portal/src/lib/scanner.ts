import jsQR from 'jsqr'
import { ApiError } from './api'

/** What the server answers to a scan (see POST /scans). */
export type ScanCode =
  | 'ACCESS_GRANTED'
  | 'INVALID_QR'
  | 'INVALID_SIGNATURE'
  | 'RETIRED_KEY'
  | 'TICKET_NOT_FOUND'
  | 'TICKET_NOT_VALID'
  | 'ALREADY_USED'
  | 'WRONG_DATE'
  | 'CANCELLED'
  | 'EXPIRED'

export interface Gate {
  id: string
  code: string
  nameEn: string
  nameAr: string
}

export interface ScanOutcome {
  result: ScanCode
  granted: boolean
  message: string
  scanId: string
  scannedAt: string
  gate: Gate
  ticket?: { ref: string; visitDate: string; typeNameEn: string; typeNameAr: string; audienceNameEn: string; audienceNameAr: string }
  usedAt?: string
}

export interface ResultView {
  /** the huge word the gate operator reads from a distance */
  headline: string
  /** one plain sentence: what to do or why */
  detail: string
  tone: 'granted' | 'denied'
}

/** How each result is shown. Denials are all red and all say "ACCESS DENIED" first, then the reason. */
export function resultView(outcome: Pick<ScanOutcome, 'result' | 'ticket'>): ResultView {
  const date = outcome.ticket?.visitDate
  switch (outcome.result) {
    case 'ACCESS_GRANTED':
      return { headline: 'ACCESS GRANTED', detail: 'Let the visitor in.', tone: 'granted' }
    case 'ALREADY_USED':
      return { headline: 'TICKET ALREADY USED', detail: 'This ticket has already been scanned. Do not let anyone in with it.', tone: 'denied' }
    case 'WRONG_DATE':
      return { headline: 'WRONG VISIT DATE', detail: date ? `This ticket is for ${date}, not today.` : 'This ticket is not for today.', tone: 'denied' }
    case 'CANCELLED':
      return { headline: 'TICKET CANCELLED', detail: 'This ticket was cancelled by the park.', tone: 'denied' }
    case 'EXPIRED':
      return { headline: 'TICKET EXPIRED', detail: 'The order was never paid, so this ticket expired.', tone: 'denied' }
    case 'TICKET_NOT_VALID':
      return { headline: 'TICKET NOT VALID', detail: 'This ticket is not valid yet: its order has not been paid.', tone: 'denied' }
    case 'TICKET_NOT_FOUND':
      return { headline: 'TICKET NOT FOUND', detail: 'No ticket exists for this code.', tone: 'denied' }
    case 'RETIRED_KEY':
      return { headline: 'TICKET NOT ACCEPTED', detail: 'This ticket was issued with a code that is no longer accepted. Send the visitor to the ticket office.', tone: 'denied' }
    case 'INVALID_QR':
    case 'INVALID_SIGNATURE':
      return { headline: 'INVALID TICKET', detail: 'This is not a valid Al-Azhar Park ticket.', tone: 'denied' }
  }
}

/** Trims what a camera or a keyboard scanner delivers (line ends, stray spaces) and refuses nonsense sizes. */
export function normalizeCode(raw: string): string | null {
  const code = raw.replace(/[\r\n\t]+/g, '').trim()
  if (code.length === 0 || code.length > 512) return null
  return code
}

/**
 * The camera sees the same QR code many times a second. After a result is shown, the same code is ignored for a few
 * seconds so one ticket held in front of the camera is not submitted again and again.
 */
export function isRepeat(code: string, last: { code: string; at: number } | null, now: number, windowMs = 4000): boolean {
  return !!last && last.code === code && now - last.at < windowMs
}

export type CameraState = 'off' | 'starting' | 'on' | 'denied' | 'none' | 'unsupported' | 'error'

/** What went wrong with the camera, from the error the browser gave. */
export function cameraStateFor(error: unknown): CameraState {
  const name = (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'none'
  return 'error'
}

export const CAMERA_MESSAGE: Record<Exclude<CameraState, 'off' | 'starting' | 'on'>, string> = {
  denied: 'Camera access was blocked. Allow the camera for this site in the browser, or type the ticket code below.',
  none: 'No camera was found on this device. Type the ticket code below, or use a handheld scanner.',
  unsupported: 'This browser cannot use the camera here (it needs a secure page). Type the ticket code below.',
  error: 'The camera could not be started. Try again, or type the ticket code below.',
}

/** Reads a QR code from one camera frame. The browser only reads the text: the server decides everything. */
export function decodeFrame(data: Uint8ClampedArray, width: number, height: number): string | null {
  return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null
}

// ───────────────────────────── the screen's state ─────────────────────────────

export type ScanScreen =
  | { phase: 'ready' }
  | { phase: 'checking'; code: string }
  | { phase: 'result'; outcome: ScanOutcome }
  | { phase: 'failed'; code: string; message: string; gateProblem: boolean }

export type ScanAction =
  | { type: 'submit'; code: string }
  | { type: 'answered'; outcome: ScanOutcome }
  | { type: 'failed'; message: string; gateProblem: boolean }
  | { type: 'next' }

/**
 * One scan at a time: while a code is being checked, or a result is on screen, no other code is accepted. The operator
 * moves on with "Scan next" (or retries a failed check).
 */
export function scanReducer(state: ScanScreen, action: ScanAction): ScanScreen {
  switch (action.type) {
    case 'submit':
      return state.phase === 'ready' || state.phase === 'failed' ? { phase: 'checking', code: action.code } : state
    case 'answered':
      return state.phase === 'checking' ? { phase: 'result', outcome: action.outcome } : state
    case 'failed':
      return state.phase === 'checking' ? { phase: 'failed', code: state.code, message: action.message, gateProblem: action.gateProblem } : state
    case 'next':
      return state.phase === 'result' || state.phase === 'failed' ? { phase: 'ready' } : state
  }
}

/**
 * A failed request is NOT a refusal: the ticket may even have been admitted before the connection dropped. So the
 * operator is told to scan again, and will see "already used" if it went through.
 */
export function failureMessage(error: unknown): { message: string; gateProblem: boolean } {
  if (error instanceof ApiError) {
    if (error.code === 'GATE_NOT_FOUND' || error.code === 'GATE_INACTIVE') return { message: 'This gate is no longer available. Choose a gate again.', gateProblem: true }
    if (error.status === 429) return { message: 'Too many scans too quickly. Wait a few seconds, then scan again.', gateProblem: false }
    if (error.status === 401 || error.status === 403) return { message: 'You are not allowed to scan tickets. Sign in again or ask an administrator.', gateProblem: false }
  }
  return { message: 'The server could not be reached, so the result is not known. Scan the ticket again: if it was already let in, you will see "already used".', gateProblem: false }
}
