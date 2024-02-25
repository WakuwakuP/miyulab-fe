export const Panel = ({
  children,
  name,
}: {
  children: React.ReactNode
  name: string
}) => {
  return (
    <section>
      <h2 className="h-[2rem] p-1 text-center bg-slate-800">
        {name}
      </h2>
      <div className="h-[calc(100vh-2rem)] overflow-y-scroll">
        {children}
      </div>
    </section>
  )
}
