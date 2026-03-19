import Head from 'next/head'
import { Box, Typography } from '@mui/material'

export default function Home() {
  return (
    <>
      <Head><title>The Matcher — Buncha</title></Head>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>The Matcher</Typography>
      </Box>
    </>
  )
}
