import type { AppProps } from 'next/app'
import { CssBaseline } from '@mui/material'
import { ThemeProvider } from '@/modules/matcher/theme/ThemeContext'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <CssBaseline />
      <Component {...pageProps} />
    </ThemeProvider>
  )
}
