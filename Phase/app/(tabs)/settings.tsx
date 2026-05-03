import { View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { theme } from '@/constants/theme';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];

  return <View style={{ flex: 1, backgroundColor: t.colors.background }} />;
}

