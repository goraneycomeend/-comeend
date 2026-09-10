import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';
import { colors } from '../../src/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function icon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: '상점', tabBarIcon: icon('storefront-outline') }} />
      <Tabs.Screen name="wishlist" options={{ title: '위시리스트', tabBarIcon: icon('heart-outline') }} />
      <Tabs.Screen name="accounts" options={{ title: '계정', tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="history" options={{ title: '기록', tabBarIcon: icon('notifications-outline') }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('settings-outline') }} />
    </Tabs>
  );
}
