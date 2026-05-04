export type AppColorScheme = 'light' | 'dark';

export const PHASE_COLORS = {
  bulk: {
    primary: '#2ECC71', // green
    bg: '#1E3A2F',
    border: '#2C6B4D',
    text: '#B9F6D0',
  },
  cut: {
    primary: '#FF6B6B', // coral/red
    bg: '#3A1E24',
    border: '#7A2C3B',
    text: '#FFC1CD',
  },
  maintain: {
    primary: '#8FA3FF', // gray/blue
    bg: '#1F2B3A',
    border: '#2E4A6B',
    text: '#C7DCFF',
  },
} as const;

export const theme = {
  light: {
    colors: {
      background: '#0B0D10',
      surface: '#11151B',
      card: '#141A22',
      text: '#E7EAF0',
      mutedText: '#A9B0BD',
      border: '#222B37',
      tint: '#8FA3FF',
      tabIconDefault: '#7F8796',
      tabIconSelected: '#E7EAF0',
    },
  },
  dark: {
    colors: {
      background: '#0B0D10',
      surface: '#11151B',
      card: '#141A22',
      text: '#E7EAF0',
      mutedText: '#A9B0BD',
      border: '#222B37',
      tint: '#8FA3FF',
      tabIconDefault: '#7F8796',
      tabIconSelected: '#E7EAF0',
    },
  },
} as const;

export type AppTheme = (typeof theme)[AppColorScheme];

