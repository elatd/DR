import { Suspense } from 'react'
import dynamic from 'next/dynamic'

// Dynamically import the client component with no SSR
const HomePage = dynamic(() => import('@/components/home-page'), {
  ssr: false,
})

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomePage />
    </Suspense>
  )
}