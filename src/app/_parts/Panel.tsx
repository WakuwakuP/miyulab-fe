export const Panel = ({
  children,
  name,
}: {
  children: React.ReactNode
  name: string
}) => {
  return (
    <section>
      <h2 className="h-[2rem]">{name}</h2>
      <div className="h-[calc(100vh-2rem)] overflow-y-scroll">
        {children}
      </div>
    </section>
  )
}
