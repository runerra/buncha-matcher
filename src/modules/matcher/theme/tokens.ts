// Warm, minimal design tokens — inspired by the reference design
export const tokens = {
  light: {
    bg: {
      primary: '#FAF9F7',
      secondary: '#F5F3F0',
      tertiary: '#EDEAE6',
      elevated: '#FFFFFF',
      card: '#FFFFFF',
    },
    text: {
      primary: '#1A1A1A',
      secondary: '#6B6B6B',
      tertiary: '#999999',
      inverse: '#FFFFFF',
    },
    border: {
      default: '#E8E5E1',
      subtle: '#F0EDE9',
      strong: '#D4D0CB',
    },
    accent: {
      primary: '#2D7A4F',
      primaryHover: '#236B42',
      decline: '#C0392B',
      declineHover: '#A93226',
    },
    urgency: {
      sameDay: '#C0392B',
      sameDayBg: '#C0392B',
      t24: '#2D7A4F',
      t24Bg: '#2D7A4F',
      t48: '#4A6FA5',
      t48Bg: '#4A6FA5',
      future: '#999999',
      futureBg: '#999999',
    },
    badge: {
      gap: '#3A3A3A',
      gapBg: '#3A3A3A',
      action: '#6B6B6B',
    },
    resolved: {
      border: '#B8D4C8',
      bg: '#F7FAF8',
      text: '#6B6B6B',
      badge: '#E8F0EC',
      badgeText: '#2D7A4F',
    },
  },
  dark: {
    bg: {
      primary: '#141414',
      secondary: '#1C1C1C',
      tertiary: '#242424',
      elevated: '#1C1C1C',
      card: '#1E1E1E',
    },
    text: {
      primary: '#E5E5E5',
      secondary: '#999999',
      tertiary: '#666666',
      inverse: '#141414',
    },
    border: {
      default: '#2E2E2E',
      subtle: '#242424',
      strong: '#3A3A3A',
    },
    accent: {
      primary: '#4CAF7A',
      primaryHover: '#3D9B68',
      decline: '#E57373',
      declineHover: '#D64545',
    },
    urgency: {
      sameDay: '#E57373',
      sameDayBg: '#E57373',
      t24: '#4CAF7A',
      t24Bg: '#4CAF7A',
      t48: '#6D9BD1',
      t48Bg: '#6D9BD1',
      future: '#666666',
      futureBg: '#666666',
    },
    badge: {
      gap: '#E5E5E5',
      gapBg: '#3A3A3A',
      action: '#999999',
    },
    resolved: {
      border: '#2D4A3A',
      bg: 'rgba(45, 122, 79, 0.06)',
      text: '#999999',
      badge: 'rgba(45, 122, 79, 0.15)',
      badgeText: '#4CAF7A',
    },
  },
}

export type ThemeTokens = typeof tokens.light
