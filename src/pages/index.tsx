import Head from 'next/head'
import { Dashboard } from '@/modules/matcher/screens/Dashboard'

export default function Home() {
  return (
    <>
      <Head><title>The Matcher — Buncha</title></Head>
      <Dashboard />
    </>
  )
}
