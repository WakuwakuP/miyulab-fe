import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from 'components/ui/carousel'

const meta = { component: Carousel, title: 'UI/Carousel' } satisfies Meta<
  typeof Carousel
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Carousel className="mx-12 w-60">
      <CarouselContent>
        {[1, 2, 3].map((page) => (
          <CarouselItem key={page}>
            <div className="flex aspect-square items-center justify-center rounded border bg-muted text-4xl">
              {page}
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  ),
}
