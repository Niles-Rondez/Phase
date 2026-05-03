import Ionicons from '@expo/vector-icons/Ionicons';
import type React from 'react';

export function TabBarIcon(props: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  size?: number;
}) {
  return <Ionicons size={props.size ?? 24} style={{ marginBottom: -2 }} {...props} />;
}

