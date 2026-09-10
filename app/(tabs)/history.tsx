import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Body, Button, Card, Empty, Muted, Screen, Title } from '../../src/components/ui';
import { formatDateTime } from '../../src/format';
import { useApp } from '../../src/store';
import { spacing } from '../../src/theme';

const KIND_ICON: Record<string, string> = { match: '🎯', summary: '🛒', reauth: '🔑', error: '⚠️', test: '🔔' };

export default function HistoryScreen() {
  const history = useApp((s) => s.history);
  const clearHistory = useApp((s) => s.clearHistory);
  const items = [...history].reverse();

  return (
    <Screen>
      <Title sub="앱이 보낸 알림 목록">알림 기록</Title>
      {items.length === 0 ? <Empty title="아직 보낸 알림이 없어요" body="위시리스트 스킨이 상점에 뜨면 여기에 기록돼요." /> : null}
      {items.map((h) => (
        <Card key={h.id} style={{ padding: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {h.icon ? <Image source={{ uri: h.icon }} style={{ width: 64, height: 28 }} contentFit="contain" /> : null}
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '700' } as never}>
                {KIND_ICON[h.kind] ?? ''} {h.title}
              </Body>
              <Muted>{formatDateTime(h.at)}</Muted>
            </View>
          </View>
          <Muted style={{ marginTop: spacing.sm } as never}>{h.body}</Muted>
        </Card>
      ))}
      {items.length > 0 ? <Button title="기록 지우기" variant="ghost" onPress={clearHistory} /> : null}
    </Screen>
  );
}
