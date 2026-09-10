import * as SecureStore from 'expo-secure-store';

/** SecureStore 키는 영숫자, '.', '-', '_' 만 허용 */
function key(puuid: string): string {
  return `riot_ssid_${puuid.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function saveSsid(puuid: string, ssid: string): Promise<void> {
  await SecureStore.setItemAsync(key(puuid), ssid, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function loadSsid(puuid: string): Promise<string | null> {
  return SecureStore.getItemAsync(key(puuid));
}

export async function deleteSsid(puuid: string): Promise<void> {
  await SecureStore.deleteItemAsync(key(puuid));
}
