export type AppColorScheme = 'light' | 'dark';

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

