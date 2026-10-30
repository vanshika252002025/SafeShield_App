import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Contacts and queued alerts are kept in Android's Keystore-backed secure storage, not in
// plain app storage. Each item is small, so every contact is saved under its own key.
const INDEX_KEY = "contactsIndex";

export async function saveContactsCache(contacts: any[]): Promise<void> {
  const oldIds: number[] = JSON.parse((await SecureStore.getItemAsync(INDEX_KEY)) || "[]");
  for (const id of oldIds) await SecureStore.deleteItemAsync(`contact_${id}`);
  for (const c of contacts) await SecureStore.setItemAsync(`contact_${c.id}`, JSON.stringify(c));
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(contacts.map((c) => c.id)));
}

export async function loadContactsCache(): Promise<any[]> {
  try {
    const ids: number[] = JSON.parse((await SecureStore.getItemAsync(INDEX_KEY)) || "[]");
    const contacts: any[] = [];
    for (const id of ids) {
      const raw = await SecureStore.getItemAsync(`contact_${id}`);
      if (raw) contacts.push(JSON.parse(raw));
    }
    return contacts;
  } catch {
    return [];
  }
}

// Wipes everything saved for offline use, including the old unencrypted copies
export async function clearOfflineData(): Promise<void> {
  try {
    const ids: number[] = JSON.parse((await SecureStore.getItemAsync(INDEX_KEY)) || "[]");
    for (const id of ids) await SecureStore.deleteItemAsync(`contact_${id}`);
  } catch {}
  await SecureStore.deleteItemAsync(INDEX_KEY).catch(() => {});
  await SecureStore.deleteItemAsync("pendingAlert").catch(() => {});
  await AsyncStorage.multiRemove(["cachedContacts", "pendingAlert"]).catch(() => {});
}