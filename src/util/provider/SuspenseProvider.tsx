import { type ReactNode, Suspense } from 'react'

export const SuspenseProvider = ({ children }: { children: ReactNode }) => {
  return <Suspense>{children}</Suspense>
}
