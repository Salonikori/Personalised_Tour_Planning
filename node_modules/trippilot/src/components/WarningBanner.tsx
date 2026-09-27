import type { ReactNode } from 'react'
export function WarningBanner({ children }: { children: ReactNode }) { return <div className="tp-warning-banner" role="alert"><span aria-hidden="true">!</span><div>{children}</div></div> }
