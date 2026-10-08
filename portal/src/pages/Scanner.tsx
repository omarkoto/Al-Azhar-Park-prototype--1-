import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Button, Card, Notice, PageHeader, Select, Spinner } from '../components/ui'
import { api, ApiError } from '../lib/api'
import {
  CAMERA_MESSAGE, cameraStateFor, decodeFrame, failureMessage, isRepeat, normalizeCode, resultView, scanReducer, type CameraState, type Gate, type ScanOutcome,
} from '../lib/scanner'
import { formatDay, formatMoment } from '../lib/ticketing'

const GATE_KEY = 'azharpark-scanner-gate'
const FRAME_MS = 130

const rememberedGate = (): string => {
  try {
    return window.localStorage.getItem(GATE_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * The gate screen. The camera (or the keyboard, or a handheld scanner that types) only delivers the text of the code;
 * the server checks it, uses the ticket up and answers. This screen shows that answer, large.
 */
export function ScannerPage() {
  const [gates, setGates] = useState<Gate[] | null>(null)
  const [gatesError, setGatesError] = useState<string | null>(null)
  const [gateId, setGateId] = useState(rememberedGate)
  const [screen, dispatch] = useReducer(scanReducer, { phase: 'ready' })
  const [manual, setManual] = useState('')
  const [manualProblem, setManualProblem] = useState<string | null>(null)
  const last = useRef<{ code: string; at: number } | null>(null)
  const inFlight = useRef(false)
  const manualInput = useRef<HTMLInputElement>(null)

  const loadGates = useCallback(async () => {
    try {
      const list = await api.get<Gate[]>('/scans/gates')
      setGates(list)
      setGatesError(null)
      setGateId((current) => (list.some((g) => g.id === current) ? current : list.length === 1 ? list[0].id : ''))
    } catch (e) {
      setGatesError(e instanceof ApiError && e.status === 403 ? 'You are not allowed to scan tickets.' : 'The gates could not be loaded. Check the connection and try again.')
    }
  }, [])

  useEffect(() => {
    void loadGates()
  }, [loadGates])

  useEffect(() => {
    try {
      if (gateId) window.localStorage.setItem(GATE_KEY, gateId)
    } catch {
      /* private mode: the gate is simply not remembered */
    }
  }, [gateId])

  const submit = useCallback(
    async (raw: string, source: 'camera' | 'typed') => {
      const code = normalizeCode(raw)
      if (!code || !gateId || inFlight.current) return
      // the camera keeps seeing the ticket held in front of it; a code someone typed or a handheld scanner sent is deliberate
      if (source === 'camera' && isRepeat(code, last.current, Date.now())) return
      inFlight.current = true
      dispatch({ type: 'submit', code })
      try {
        const outcome = await api.post<ScanOutcome>('/scans', { qr: code, gateId })
        last.current = { code, at: Date.now() }
        dispatch({ type: 'answered', outcome })
      } catch (e) {
        const f = failureMessage(e)
        dispatch({ type: 'failed', ...f })
        if (f.gateProblem) void loadGates()
      } finally {
        inFlight.current = false
      }
    },
    [gateId, loadGates],
  )

  // when the screen is ready again the cursor is in the code box (a handheld scanner types straight into it)
  useEffect(() => {
    if (screen.phase === 'ready' && gateId && gates?.some((g) => g.id === gateId)) manualInput.current?.focus()
  }, [screen.phase, gateId, gates])

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    if (!normalizeCode(manual)) {
      setManualProblem('Type or scan the ticket code first.')
      return
    }
    setManualProblem(null)
    void submit(manual, 'typed')
    setManual('')
  }

  const gate = gates?.find((g) => g.id === gateId)
  const ready = screen.phase === 'ready'

  return (
    <div className="space-y-6">
      <PageHeader title="Gate scanner" description="Choose your gate, then scan each visitor's ticket. The result below comes from the server: if it says ACCESS GRANTED the ticket has just been used up." />

      {gatesError && (
        <Notice tone="error">
          {gatesError}{' '}
          <button className="font-semibold underline" onClick={() => void loadGates()}>
            Try again
          </button>
        </Notice>
      )}
      {!gates && !gatesError && <Spinner label="Loading gates…" />}

      {gates && (
        <Card>
          <div className="grid gap-3 sm:max-w-sm">
            <Select label="Your gate" value={gateId} onChange={(e) => setGateId(e.target.value)} data-testid="gate-select">
              <option value="">Choose a gate…</option>
              {gates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameEn}
                </option>
              ))}
            </Select>
            {gates.length === 0 && <p className="text-sm text-amber-800">No gate is switched on. Ask an administrator.</p>}
          </div>
        </Card>
      )}

      {gates && !gateId && gates.length > 0 && <Notice tone="info">Choose the gate you are working at to start scanning.</Notice>}

      {gate && (
        <>
          {screen.phase === 'checking' && (
            <div className="rounded-2xl border-4 border-stone-300 bg-stone-100 p-10 text-center" role="status" data-testid="scan-checking">
              <p className="text-3xl font-bold text-stone-700">Checking ticket…</p>
            </div>
          )}

          {screen.phase === 'result' && <ResultPanel outcome={screen.outcome} onNext={() => dispatch({ type: 'next' })} />}

          {screen.phase === 'failed' && (
            <div className="rounded-2xl border-4 border-amber-500 bg-amber-50 p-8 text-center" role="alert" data-testid="scan-failed">
              <p className="text-3xl font-extrabold text-amber-900">COULD NOT CHECK</p>
              <p className="mx-auto mt-3 max-w-xl text-lg text-amber-900">{screen.message}</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {!screen.gateProblem && (
                  <Button
                    className="px-8 py-4 text-lg"
                    onClick={() => {
                      const code = screen.code
                      last.current = null
                      void submit(code, 'typed')
                    }}
                  >
                    Check again
                  </Button>
                )}
                <Button autoFocus variant="secondary" className="px-8 py-4 text-lg" onClick={() => dispatch({ type: 'next' })}>
                  Scan next ticket
                </Button>
              </div>
            </div>
          )}

          <div className={ready ? '' : 'pointer-events-none opacity-50'} aria-hidden={ready ? undefined : true}>
            <Card title="Scan a ticket" description={`Gate: ${gate.nameEn}`}>
              <div className="grid gap-6 lg:grid-cols-2">
                <CameraView active={ready} onCode={(c) => void submit(c, 'camera')} />
                <form onSubmit={submitManual} className="space-y-3" data-testid="manual-form">
                  <label className="block text-sm font-medium text-stone-800" htmlFor="manual-code">
                    Type or scan the ticket code
                  </label>
                  <p className="text-xs text-stone-500">Use this if the camera does not work, or with a handheld scanner (it types the code and presses Enter).</p>
                  <input
                    id="manual-code"
                    ref={manualInput}
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="AZP1.TKT-…"
                    className="w-full rounded-lg border border-stone-300 px-3 py-3 font-mono text-sm outline-none focus:border-teal-700"
                    data-testid="manual-code"
                  />
                  {manualProblem && <p className="text-sm text-red-700">{manualProblem}</p>}
                  <Button type="submit" className="w-full py-3 text-base" disabled={!ready}>
                    Check ticket
                  </Button>
                </form>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function ResultPanel({ outcome, onNext }: { outcome: ScanOutcome; onNext: () => void }) {
  const view = resultView(outcome)
  const granted = view.tone === 'granted'
  const t = outcome.ticket
  return (
    <div
      className={`rounded-2xl border-8 p-8 text-center shadow-lg ${granted ? 'border-emerald-600 bg-emerald-50 text-emerald-950' : 'border-red-600 bg-red-50 text-red-950'}`}
      role="alert"
      data-testid="scan-result"
      data-result={outcome.result}
      data-granted={granted ? 'true' : 'false'}
    >
      {!granted && <p className="text-xl font-bold uppercase tracking-widest text-red-700">Access denied</p>}
      <p className="mt-1 text-5xl font-black leading-tight sm:text-6xl" data-testid="scan-headline">
        {view.headline}
      </p>
      <p className="mx-auto mt-4 max-w-2xl text-xl" data-testid="scan-detail">
        {view.detail}
      </p>
      {outcome.result === 'ALREADY_USED' && outcome.usedAt && <p className="mt-2 text-lg font-semibold">First used {formatMoment(outcome.usedAt)}</p>}

      <dl className="mx-auto mt-6 grid max-w-xl gap-x-8 gap-y-2 text-left text-base sm:grid-cols-2">
        {t && (
          <>
            <div>
              <dt className="text-xs uppercase opacity-70">Ticket</dt>
              <dd className="font-mono font-semibold" data-testid="scan-ref">{t.ref}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-70">Visit date</dt>
              <dd className="font-semibold">{formatDay(t.visitDate)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase opacity-70">Ticket type</dt>
              <dd className="font-semibold">{t.typeNameEn} · {t.audienceNameEn}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-xs uppercase opacity-70">Gate</dt>
          <dd className="font-semibold">{outcome.gate.nameEn}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase opacity-70">Scanned</dt>
          <dd className="font-semibold">{formatMoment(outcome.scannedAt)}</dd>
        </div>
      </dl>

      <Button autoFocus className="mt-8 px-10 py-5 text-xl" onClick={onNext} data-testid="scan-next">
        Scan next ticket
      </Button>
    </div>
  )
}

/** The camera preview. It reads codes while `active`, and always lets go of the camera when it is removed. */
function CameraView({ active, onCode }: { active: boolean; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [state, setState] = useState<CameraState>('off')
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode
  const activeRef = useRef(active)
  activeRef.current = active

  // each start gets a number; a camera that arrives after the screen was left (or after a newer start) is released at once
  const attempt = useRef(0)

  const stop = useCallback(() => {
    attempt.current += 1
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported')
      return
    }
    setState('starting')
    const mine = ++attempt.current
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      if (mine !== attempt.current) {
        s.getTracks().forEach((t) => t.stop())
        return
      }
      stream.current?.getTracks().forEach((t) => t.stop())
      stream.current = s
      if (video.current) {
        video.current.srcObject = s
        await video.current.play().catch(() => undefined)
      }
      setState('on')
    } catch (e) {
      if (mine === attempt.current) setState(cameraStateFor(e))
    }
  }, [])

  useEffect(() => {
    void start()
    return stop // leaving the screen releases the camera
  }, [start, stop])

  // read a frame a few times a second while the screen is waiting for a ticket
  useEffect(() => {
    if (state !== 'on') return
    const timer = window.setInterval(() => {
      const v = video.current
      const c = canvas.current
      if (!activeRef.current || !v || !c || v.readyState < 2 || v.videoWidth === 0) return
      const scale = Math.min(1, 720 / v.videoWidth)
      c.width = Math.round(v.videoWidth * scale)
      c.height = Math.round(v.videoHeight * scale)
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(v, 0, 0, c.width, c.height)
      const image = ctx.getImageData(0, 0, c.width, c.height)
      const code = decodeFrame(image.data, image.width, image.height)
      if (code) onCodeRef.current(code)
    }, FRAME_MS)
    return () => window.clearInterval(timer)
  }, [state])

  const problem = state === 'denied' || state === 'none' || state === 'unsupported' || state === 'error' ? CAMERA_MESSAGE[state] : null
  return (
    <div className="space-y-3" data-testid="camera" data-camera={state}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-stone-900">
        <video ref={video} className="h-full w-full object-cover" playsInline muted data-testid="camera-video" />
        <canvas ref={canvas} className="hidden" />
        {state === 'on' && <div className="pointer-events-none absolute inset-8 rounded-2xl border-4 border-white/70" aria-hidden="true" />}
        {(state === 'starting' || state === 'off') && <p className="absolute inset-0 flex items-center justify-center text-sm text-stone-300">Starting the camera…</p>}
        {problem && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-stone-200" data-testid="camera-problem">{problem}</p>}
      </div>
      {problem && (
        <Button variant="secondary" onClick={() => void start()}>
          Try the camera again
        </Button>
      )}
    </div>
  )
}
