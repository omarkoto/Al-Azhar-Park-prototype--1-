function findVisibleCartIcon(): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-cart-icon-target]'))
  return candidates.find((el) => el.offsetParent !== null) ?? candidates[0] ?? null
}

export function flyToCart(originEl: HTMLElement) {
  const target = findVisibleCartIcon()
  if (!target || typeof window === 'undefined') return

  const fromRect = originEl.getBoundingClientRect()
  const toRect = target.getBoundingClientRect()
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reduceMotion) {
    bumpCartIcon(target)
    return
  }

  const el = document.createElement('div')
  el.textContent = '🎫'
  Object.assign(el.style, {
    position: 'fixed',
    zIndex: '200',
    left: `${fromRect.left + fromRect.width / 2 - 13}px`,
    top: `${fromRect.top + fromRect.height / 2 - 13}px`,
    width: '26px',
    height: '26px',
    fontSize: '20px',
    lineHeight: '26px',
    textAlign: 'center',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)

  const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2)
  const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2)
  const arcLift = -Math.min(180, Math.abs(dx) * 0.45 + 70)

  const anim = el.animate(
    [
      { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.55 + arcLift}px) scale(1.15) rotate(15deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.25) rotate(-10deg)`, opacity: 0.15, offset: 1 },
    ],
    { duration: 700, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
  )
  anim.onfinish = () => {
    el.remove()
    bumpCartIcon(target)
  }
}

function bumpCartIcon(target: HTMLElement) {
  target.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], {
    duration: 380,
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  })
}
