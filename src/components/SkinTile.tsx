import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { ResolvedOffer } from '../riot/types';
import { colors, radius, spacing } from '../theme';

export function SkinTile({ offer, matched }: { offer: ResolvedOffer; matched: boolean }) {
  return (
    <View style={[styles.tile, matched && styles.tileMatched]}>
      <View style={[styles.tierBar, { backgroundColor: offer.tierColor ?? colors.border }]} />
      {matched ? (
        <View style={styles.wishTag}>
          <Text style={styles.wishTagText}>♥ 위시</Text>
        </View>
      ) : null}
      <View style={styles.imageWrap}>
        {offer.icon ? (
          <Image source={{ uri: offer.icon }} style={styles.image} contentFit="contain" transition={150} />
        ) : (
          <Text style={styles.noImage}>?</Text>
        )}
      </View>
      <Text style={styles.weapon} numberOfLines={1}>
        {offer.weapon}
      </Text>
      <Text style={styles.name} numberOfLines={2}>
        {offer.name}
      </Text>
      <View style={styles.priceRow}>
        {offer.discountedCost != null ? (
          <>
            <Text style={styles.strike}>{offer.cost}</Text>
            <Text style={styles.price}>{offer.discountedCost} VP</Text>
            <Text style={styles.discount}>-{offer.discountPercent}%</Text>
          </>
        ) : (
          <Text style={styles.price}>{offer.cost} VP</Text>
        )}
      </View>
      {offer.tierName ? <Text style={[styles.tier, { color: offer.tierColor ?? colors.muted }]}>{offer.tierName}</Text> : null}
    </View>
  );
}

export function SkinGrid({ offers, matchedIds }: { offers: ResolvedOffer[]; matchedIds: Set<string> }) {
  return (
    <View style={styles.grid}>
      {offers.map((o) => (
        <SkinTile key={`${o.kind}-${o.offerId}`} offer={o} matched={matchedIds.has(o.offerId)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    width: '48.5%',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tileMatched: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  tierBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  wishTag: { position: 'absolute', right: 8, top: 8, backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, zIndex: 1 },
  wishTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  imageWrap: { height: 64, justifyContent: 'center', alignItems: 'center', marginBottom: spacing.sm },
  image: { width: '100%', height: 64 },
  noImage: { color: colors.muted, fontSize: 24 },
  weapon: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  name: { color: colors.text, fontSize: 14, fontWeight: '700', minHeight: 36 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  price: { color: colors.vp, fontWeight: '800', fontSize: 14 },
  strike: { color: colors.muted, textDecorationLine: 'line-through', fontSize: 12 },
  discount: { color: colors.success, fontSize: 12, fontWeight: '700' },
  tier: { fontSize: 11, marginTop: 4, fontWeight: '600' },
});
