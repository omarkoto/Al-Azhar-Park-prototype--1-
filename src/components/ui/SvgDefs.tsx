export function SvgDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="arch-clip" clipPathUnits="objectBoundingBox">
          {/* Two-centered Islamic/Mamluk doorway arch, equilateral proportion (rise ≈ 0.87 × span) —
              tall straight jambs occupy the bottom ~70% of the frame; the arc occupies only the top
              ~30%, converging to a short, compact, centered point — a real doorway, not a dome. */}
          <path d="M0,1 L0,0.3 L0.001,0.2849 L0.0038,0.2698 L0.0086,0.2548 L0.0152,0.2398 L0.0237,0.225 L0.0341,0.2103 L0.0463,0.1958 L0.0603,0.1815 L0.0761,0.1674 L0.0937,0.1536 L0.113,0.14 L0.134,0.1268 L0.1566,0.1139 L0.1808,0.1013 L0.2066,0.0891 L0.234,0.0773 L0.2627,0.066 L0.2929,0.0551 L0.3244,0.0446 L0.3572,0.0346 L0.3912,0.0252 L0.4264,0.0162 L0.4627,0.0078 L0.5,0 L0.5373,0.0078 L0.5736,0.0162 L0.6088,0.0252 L0.6428,0.0346 L0.6756,0.0446 L0.7071,0.0551 L0.7373,0.066 L0.766,0.0773 L0.7934,0.0891 L0.8192,0.1013 L0.8434,0.1139 L0.866,0.1268 L0.887,0.14 L0.9063,0.1536 L0.9239,0.1674 L0.9397,0.1815 L0.9537,0.1958 L0.9659,0.2103 L0.9763,0.225 L0.9848,0.2398 L0.9914,0.2548 L0.9962,0.2698 L0.999,0.2849 L1,0.3 L1,1 Z" />
        </clipPath>
        {/* Wide pointed arch — the same doorway language as arch-clip, stretched into a landscape window. */}
        <clipPath id="arch-wide-clip" clipPathUnits="objectBoundingBox">
          <path d="M0,1 L0,0.36 C0,0.21 0.15,0.11 0.33,0.06 C0.42,0.035 0.47,0.018 0.5,0 C0.53,0.018 0.58,0.035 0.67,0.06 C0.85,0.11 1,0.21 1,0.36 L1,1 Z" />
        </clipPath>
      </defs>
    </svg>
  )
}
