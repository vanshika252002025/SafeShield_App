import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { Voice } = NativeModules;
const ENABLED_KEY = "voiceEnabled";
const PHRASE_KEY = "voicePhrase";

export type VoiceStatus = {
  running: boolean;
  ready: boolean;
  lastHeard: string;
  lastHitAt: number;
  error: string;
};

// The speech model only knows English words, so keep letters and spaces only
export function normalizePhrase(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Returns a problem to show the user, or null if the phrase is fine
export function validatePhrase(raw: string): string | null {
  const p = normalizePhrase(raw);
  if (p.split(" ").filter(Boolean).length < 2) return "Use at least two words.";
  if (p.replace(/\s/g, "").length < 8) {
    return "Use at least 8 letters in total, so everyday talk doesn't set it off.";
  }
  return null;
}

export async function getSavedPhrase(): Promise<string> {
  return (await AsyncStorage.getItem(PHRASE_KEY)) || "";
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  try {
    return await Voice.getStatus();
  } catch {
    return { running: false, ready: false, lastHeard: "", lastHitAt: 0, error: "" };
  }
}

export async function setVoiceTestMode(on: boolean): Promise<void> {
  try {
    await Voice?.setTestMode(on);
  } catch {}
}

export async function stopVoice(): Promise<void> {
  await Voice?.stop();
  await AsyncStorage.setItem(ENABLED_KEY, "0");
}

export async function startVoice(): Promise<void> {
  if (Platform.OS !== "android" || !Voice) throw new Error("Voice trigger needs the Android app build.");
  const phrase = await getSavedPhrase();
  if (!phrase) throw new Error("Save your phrase first.");

  const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (mic !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error("Microphone permission is needed for the voice trigger.");
  }
  if (Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  await Voice.setPhrase(phrase);
  await Voice.start();
  await AsyncStorage.setItem(ENABLED_KEY, "1");
}

// Saves a new phrase and restarts the listener if it is running
export async function saveVoicePhrase(raw: string): Promise<string> {
  const phrase = normalizePhrase(raw);
  await AsyncStorage.setItem(PHRASE_KEY, phrase);
  await Voice?.setPhrase(phrase);
  const status = await getVoiceStatus();
  if (status.running) {
    await Voice.stop();
    setTimeout(() => Voice.start().catch(() => {}), 800);
  }
  return phrase;
}

// After a restart, or if Android closed the service, turn it back on when the app opens
export async function restoreVoiceIfEnabled(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(ENABLED_KEY)) !== "1") return;
    const status = await getVoiceStatus();
    if (!status.running) await startVoice();
  } catch {}
}