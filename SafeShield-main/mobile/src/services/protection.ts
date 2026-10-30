import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Sensitivity } from "./shake";

const { Protection } = NativeModules;
const ENABLED_KEY = "protectionEnabled";

export type MissingSetup = "overlay" | "battery";

export async function isProtectionRunning(): Promise<boolean> {
  try {
    return !!(await Protection?.isRunning());
  } catch {
    return false;
  }
}

// Settings the user still has to allow for Protection mode to open over the lock screen
export async function getMissingSetup(): Promise<MissingSetup[]> {
  const missing: MissingSetup[] = [];
  try {
    if (!(await Protection.canDrawOverlays())) missing.push("overlay");
    if (!(await Protection.isIgnoringBatteryOptimizations())) missing.push("battery");
  } catch {}
  return missing;
}

export async function startProtection(): Promise<void> {
  if (Platform.OS !== "android" || !Protection) {
    throw new Error("Protection mode needs the Android app build.");
  }
  if (Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  await Protection.setSensitivity(SENS_LEVEL[await getSensitivity()]);
  await Protection.start();
  await AsyncStorage.setItem(ENABLED_KEY, "1");
}

export async function stopProtection(): Promise<void> {
  await Protection?.stop();
  await AsyncStorage.setItem(ENABLED_KEY, "0");
}

// After a restart or when Android closed the service, turn it back on when the app opens
export async function restoreProtectionIfEnabled(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(ENABLED_KEY)) === "1" && !(await isProtectionRunning())) {
      await Protection.start();
    }
  } catch {}
}

export async function isDeviceLocked(): Promise<boolean> {
  try {
    return !!(await Protection?.isDeviceLocked());
  } catch {
    return false;
  }
}

export function openOverlaySettings() {
  Protection?.openOverlaySettings();
}

export function requestBatteryExemption() {
  Protection?.requestIgnoreBatteryOptimizations();
}

const SENS_KEY = "shakeSensitivity";
const SENS_LEVEL: Record<Sensitivity, number> = { low: 0, medium: 1, high: 2 };

export async function getSensitivity(): Promise<Sensitivity> {
  const v = await AsyncStorage.getItem(SENS_KEY);
  return v === "low" || v === "high" ? v : "medium";
}

// Saves the choice, tells the Android service, and makes a running service reload it
export async function setSensitivity(level: Sensitivity): Promise<void> {
  await AsyncStorage.setItem(SENS_KEY, level);
  try {
    await Protection?.setSensitivity(SENS_LEVEL[level]);
    if (await isProtectionRunning()) await Protection.start();
  } catch {}
}