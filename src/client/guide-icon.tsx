/**
 * The plugin's guide-capsule glyph: the ± change mark, drawn at the capsule's
 * size. The props mirror the sidebar-right `IconProps` structurally, so the
 * component satisfies the guide entry contract without a runtime dependency.
 */
import type { ReactNode } from 'react'

/** Glyph props shared with the sidebar-right guide entry contract. */
export interface GuideIconProps {
  /** Rendered square size in px. */
  readonly size?: number
  /** Class forwarded to the svg root. */
  readonly className?: string
}

/** Draw the ± change mark. */
export function GitPilotGuideIcon({ size = 22, className }: GuideIconProps): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} aria-hidden>
      <path
        d="M8 2.2v6.4M4.8 5.4h6.4M4.8 12.6h6.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}
