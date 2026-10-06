import { ARCH_PATH } from '../../lib/archPath'

export function SvgDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="arch-clip" clipPathUnits="objectBoundingBox">
          {/* Two-centered Islamic/Mamluk doorway arch, equilateral proportion (rise ≈ 0.87 × span) —
              tall straight jambs occupy the bottom ~70% of the frame; the arc occupies only the top
              ~30%, converging to a short, compact, centered point — a real doorway, not a dome. */}
          <path d={ARCH_PATH} />
        </clipPath>
        {/* Wide pointed arch — the same doorway language as arch-clip, stretched into a landscape window. */}
        <clipPath id="arch-wide-clip" clipPathUnits="objectBoundingBox">
          <path d="M0,1 L0,0.36 C0,0.21 0.15,0.11 0.33,0.06 C0.42,0.035 0.47,0.018 0.5,0 C0.53,0.018 0.58,0.035 0.67,0.06 C0.85,0.11 1,0.21 1,0.36 L1,1 Z" />
        </clipPath>
      </defs>
    </svg>
  )
}
