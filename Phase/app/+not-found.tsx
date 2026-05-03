import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { theme } from '@/constants/theme';

export default function NotFoundScreen() {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Not found',
          headerStyle: { backgroundColor: t.colors.card },
          headerTintColor: t.colors.text,
          headerTitleStyle: { color: t.colors.text },
        }}
      />
      <View style={[styles.container, { backgroundColor: t.colors.background }]}>
        <Text style={[styles.title, { color: t.colors.text }]}>This screen doesn&apos;t exist.</Text>

        <Link href="/" style={styles.link}>
          <Text style={[styles.linkText, { color: t.colors.tint }]}>Go to home screen</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
