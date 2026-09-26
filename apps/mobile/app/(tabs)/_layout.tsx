/**
 * Tab bar flotante de cristal.
 *
 * El diseño la dibuja como una píldora de 66px separada del borde, no como la
 * barra estándar del sistema, así que se renderiza a medida sobre el contenido.
 */

import { GlassCard, useTheme } from '@wagerwise/ui';
import { Tabs } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useBuilder } from '@/state/builder';

/**
 * expo-router 57 trae sus propios tipos de bottom-tabs, distintos de los de
 * @react-navigation aunque se llamen igual. Derivar el tipo del prop `tabBar`
 * usa la API pública y evita que dos copias del paquete choquen.
 */
type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Los mismos trazos SVG del diseño. */
const ICONS: Record<string, string> = {
  index: 'M3.5 5.5h13v11h-13zM3.5 9h13M7 2.8v2.8M13 2.8v2.8M6.6 12.4h2M11.4 12.4h2',
  builder: 'M3 6.2l7-3.2 7 3.2-7 3.2-7-3.2zM3 10l7 3.2 7-3.2M3 13.8l7 3.2 7-3.2',
  alerts: 'M11.2 2.4L5 10.6h3.6l-.9 6.9 6.3-8.7h-3.6l.8-6.4z',
  bets: 'M3 3v14h14M5.6 13.6l3.2-4 2.4 2.2 3.4-5.6M12.4 6.2h2.4v2.4',
  profile: 'M10 9.2a3.1 3.1 0 100-6.2 3.1 3.1 0 000 6.2zM3.8 17.2c0-3.1 2.8-5.2 6.2-5.2s6.2 2.1 6.2 5.2',
};

const LABELS: Record<string, string> = {
  index: 'Hoy',
  builder: 'Parlay',
  alerts: 'Valor',
  bets: 'Apuestas',
  profile: 'Perfil',
};

export default function TabsLayout(): React.ReactElement {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <GlassTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="builder" />
      <Tabs.Screen name="alerts" />
      <Tabs.Screen name="bets" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

function GlassTabBar({ state, navigation }: TabBarProps): React.ReactElement {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const legCount = useBuilder((s) => s.legs.length);

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 16) }]}>
      <GlassCard variant="tabBar" style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const color = focused ? theme.colors.accent : theme.colors.ink3;
          const badge = route.name === 'builder' && legCount > 0 ? legCount : null;

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={LABELS[route.name] ?? route.name}
              style={[
                styles.item,
                {
                  borderRadius: theme.radius.tabItem,
                  backgroundColor: focused ? theme.colors.accentSoft : 'transparent',
                },
              ]}
            >
              <Svg width={20} height={20} viewBox="0 0 20 20" fill="none">
                <Path
                  d={ICONS[route.name] ?? ''}
                  stroke={color}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              <Text style={[theme.type.tabLabel, { color }]}>
                {LABELS[route.name] ?? route.name}
              </Text>

              {badge !== null ? (
                <View style={[styles.badge, { backgroundColor: theme.colors.accent }]}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: 14 },
  bar: { flexDirection: 'row', alignItems: 'center', height: 66, paddingHorizontal: 8, gap: 2 },
  item: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 8,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', lineHeight: 13 },
});
