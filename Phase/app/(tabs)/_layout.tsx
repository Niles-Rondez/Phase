import { Tabs } from 'expo-router';

import { TabBarIcon } from '@/components/TabBarIcon';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import { theme } from '@/constants/theme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const t = theme[colorScheme ?? 'dark'];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.colors.tabIconSelected,
        tabBarInactiveTintColor: t.colors.tabIconDefault,
        tabBarStyle: { backgroundColor: t.colors.card, borderTopColor: t.colors.border },
        headerStyle: { backgroundColor: t.colors.card },
        headerTitleStyle: { color: t.colors.text },
        headerTintColor: t.colors.text,
        // Disable the static render of the header on web
        // to prevent a hydration error in React Navigation v6.
        headerShown: useClientOnlyValue(false, true),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <TabBarIcon name="home-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ color }) => <TabBarIcon name="list-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ color }) => <TabBarIcon name="bar-chart-outline" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabBarIcon name="settings-outline" color={color} />,
        }}
      />
    </Tabs>
  );
}
