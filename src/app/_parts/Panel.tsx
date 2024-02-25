import { ReactNode } from 'react'

export const Panel = ({
  children,
  name,
}: {
  children: ReactNode
  name: string
}) => {
  return (
    <section>
      <h2 className="h-[2rem] bg-slate-800 p-1 text-center">
        {name}
      </h2>
      <div className="h-[calc(100vh-2rem)] overflow-y-scroll">
        {children}
      </div>
    </section>
  )
}
