import NetInfo from "@react-native-community/netinfo";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, TextInput, Alert, Switch, AppState } from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { placeSilentCall, waitForCallEnd } from "../services/silentCall";
import type { CallOutcome } from "../services/silentCall";
import { sendSilentSms } from "../services/silentSms";
import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BASE_URL } from "../config";
import {
  startProtection,
  stopProtection,
  isProtectionRunning,
  restoreProtectionIfEnabled,
  getMissingSetup,
  isDeviceLocked,
  openOverlaySettings,
  requestBatteryExemption,
  getSensitivity,
  setSensitivity,
} from "../services/protection";
import { createShakeDetector } from "../services/shake";
import { restoreVoiceIfEnabled } from "../services/voice";
import { saveContactsCache, loadContactsCache, clearOfflineData } from "../services/secureCache";
import type { Sensitivity } from "../services/shake";
import type { MissingSetup } from "../services/protection";

const COUNTDOWN_SECONDS = 10;
const RING_WAIT_MS = 25000; // fallback wait between calls when the call status can't be read
const CALL_MAX_WAIT_MS = 120000; // stop waiting on a single call after 2 minutes
const EMERGENCY_NUMBER = "112"; // dialled last, only if the user switched "Also call 112" on
const ANSWERED_SECONDS = 20; // a call connected this long counts as a real conversation
const CONTACTS_CACHE_KEY = "cachedContacts"; // same key the Contacts screen writes to

const SHAKE_GRACE_MS = 3000; // ignore motion this long after the screen becomes ready

type SosState =
  | "IDLE"
  | "TRIGGERED"
  | "VERIFYING"
  | "CANCELLED"
  | "ACTIVE"
  | "COMMUNICATING"
  | "MONITORING"
  | "COMPLETED";

type TriggerType = "manual" | "shake" | "voice";

async function authHeader() {
  const token = await SecureStore.getItemAsync("authToken");
  return { Authorization: `Bearer ${token}` };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export default function SOSScreen() {
  const router = useRouter();
  const [state, setState] = useState<SosState>("IDLE");
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [pinInput, setPinInput] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [notifiedCount, setNotifiedCount] = useState(0);
  const [called112, setCalled112] = useState(false);
  const [protectionOn, setProtectionOn] = useState(false);
  const [missingSetup, setMissingSetup] = useState<MissingSetup[]>([]);
  const [deviceLocked, setDeviceLocked] = useState(false);
  const [sensitivity, setSensitivityState] = useState<Sensitivity>("medium");
  const [hasKeyword, setHasKeyword] = useState(false);
  const [showEndCheck, setShowEndCheck] = useState(false);

  // Set when Protection mode opens this screen after a shake (even from the lock screen)
  const { trigger, t } = useLocalSearchParams<{ trigger?: string; t?: string }>();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // These are refs (not state) so async code always sees the latest value, even
  // when the alert record is still being created as the countdown ends.
  const alertIdRef = useRef<number | null>(null);
  const alertReadyRef = useRef<Promise<void>>(Promise.resolve());
  const triggerTypeRef = useRef<TriggerType>("manual");
  const alertTokenRef = useRef<string | null>(null); // secret for the live-tracking link
  // Set when the user ends the session, so no further backup calls are placed
  const stopCallingRef = useRef(false);

  async function updateAlertStatus(status: string) {
    await alertReadyRef.current;
    const id = alertIdRef.current;
    if (!id) return;
    try {
      const headers = await authHeader();
      await axios.patch(`${BASE_URL}/alerts/${id}`, { status }, { headers, timeout: 8000 });
      console.log(`Alert ${id} status updated to: ${status}`);
    } catch (err) {
      console.warn(`FAILED to update alert ${id} to ${status}:`, err);
    }
  }

  // Records what happened to each contact. Never awaited by the calling code,
  // so a slow or offline server can never delay the next call or SMS.
  async function logAction(contactId: number, actionType: "call" | "sms", status: "sent" | "failed") {
    try {
      await alertReadyRef.current;
      const id = alertIdRef.current;
      if (!id) return;
      const headers = await authHeader();
      await axios.post(
        `${BASE_URL}/alerts/${id}/actions`,
        { contact_id: contactId, action_type: actionType, status },
        { headers, timeout: 8000 }
      );
    } catch (err) {
      console.warn("Could not log action:", err);
    }
  }

  async function getCurrentLocation(): Promise<{ lat: number; lng: number; isLastKnown: boolean } | null> {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return null;

      try {
        const loc = await Promise.race([
          Location.getCurrentPositionAsync({}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
        ]);
        return { lat: loc.coords.latitude, lng: loc.coords.longitude, isLastKnown: false };
      } catch (freshLocationErr) {
        console.warn("Fresh location timed out or failed, trying last-known:", freshLocationErr);
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown) {
          return { lat: lastKnown.coords.latitude, lng: lastKnown.coords.longitude, isLastKnown: true };
        }
        return null;
      }
    } catch (err) {
      console.warn("Could not get any location:", err);
      return null;
    }
  }

  async function attemptWithRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (retries > 0) {
        await sleep(2000);
        return attemptWithRetry(fn, retries - 1);
      }
      throw err;
    }
  }

  // TRIGGERED - create the alert record in the background, then start the countdown
  useEffect(() => {
    if (state !== "TRIGGERED") return;

    setSecondsLeft(COUNTDOWN_SECONDS);
    alertIdRef.current = null;
    alertTokenRef.current = null;

    alertReadyRef.current = (async () => {
      const location = await getCurrentLocation();
      const payload = {
        trigger_type: triggerTypeRef.current,
        latitude: location?.lat,
        longitude: location?.lng,
      };
      try {
        const headers = await authHeader();
        const { data } = await axios.post(`${BASE_URL}/alerts`, payload, { headers, timeout: 8000 });
        alertIdRef.current = data.alert.id;
        alertTokenRef.current = data.alert.tracking_token ?? null;
      } catch (err) {
        console.warn("Could not create alert record - saving locally for retry:", err);
        await savePendingAlert({ ...payload, queuedAt: new Date().toISOString() });
      }
    })();

    // A spoken trigger sends straight away; everything else gets the cancel countdown
    setState(triggerTypeRef.current === "voice" ? "ACTIVE" : "VERIFYING");
  }, [state]);

  // VERIFYING - the countdown timer, moves to ACTIVE when it reaches zero
  useEffect(() => {
    if (state !== "VERIFYING") return;

    if (secondsLeft <= 0) {
      setState("ACTIVE");
      return;
    }

    timerRef.current = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [state, secondsLeft]);

  // ACTIVE - pass-through
  useEffect(() => {
    if (state === "ACTIVE") {
      setState("COMMUNICATING");
    }
  }, [state]);

  // COMMUNICATING - calls and SMS run at the same time, not one after the other
  useEffect(() => {
    if (state !== "COMMUNICATING") return;

    stopCallingRef.current = false;

    (async () => {
      const headers = await authHeader();

      // 1. Get the contacts. If the server can't be reached, use the copy saved
      //    on the phone, so calls and SMS still go out with no internet.
      let contacts: any[] = [];
      try {
        const { data } = await axios.get(`${BASE_URL}/contacts`, { headers, timeout: isOnline ? 5000 : 1500 });
        contacts = data.contacts;
        saveContactsCache(contacts).catch(() => {});
      } catch (err) {
        console.warn("Could not fetch contacts - using the saved copy:", err);
        try {
          contacts = await loadContactsCache();
        } catch (cacheErr) {
          console.warn("Could not read the saved contacts either:", cacheErr);
        }
      }

      // Contacts that at least one call or SMS was successfully sent to
      const reached = new Set<number>();

      // Task A: call the primary contact, then the backups in order.
      // The next call is only placed after the previous one has ENDED, so a backup
      // call can never cut into a call that was answered.
      const callTask = async () => {
        const callSequence = contacts
          .filter((c) => c.is_primary_call || c.call_order > 0)
          .sort((a, b) => {
            if (a.is_primary_call) return -1;
            if (b.is_primary_call) return 1;
            return a.call_order - b.call_order;
          });

        if (callSequence.length === 0) {
          console.warn("No primary or backup contacts set - skipping automatic calling.");
        }

        let someoneAnswered = false;
        let unsure = false; // true when a call could not be watched, so we cannot tell if it was answered

        for (let i = 0; i < callSequence.length; i++) {
          if (stopCallingRef.current) break;

          const contact = callSequence[i];
          const placedAt = Date.now();

          try {
            await attemptWithRetry(() => placeSilentCall(contact.phone));
            reached.add(contact.id);
            logAction(contact.id, "call", "sent");
          } catch (callErr) {
            console.warn(`Call to ${contact.name} failed:`, callErr);
            logAction(contact.id, "call", "failed");
            continue;
          }

          // Wait for this call to finish (answered, rejected, busy or unanswered)
          let outcome: CallOutcome = { observed: false };
          try {
            outcome = await waitForCallEnd(contact.phone, placedAt, CALL_MAX_WAIT_MS);
          } catch (waitErr) {
            console.warn("Could not watch the call:", waitErr);
          }

          if (!outcome.observed) {
            // Call status permission is missing: fall back to a fixed timer
            unsure = true;
            if (i < callSequence.length - 1) await sleep(RING_WAIT_MS);
            continue;
          }

          const stillInCall = !!outcome.started && !outcome.ended;
          const connected = outcome.connectedSeconds ?? -1;
          const answered =
            stillInCall ||
            (connected >= 0 ? connected >= ANSWERED_SECONDS : (outcome.totalSeconds ?? 0) >= 45);

          if (answered) {
            console.log(`${contact.name} answered - no more backup calls needed.`);
            someoneAnswered = true;
            break;
          }
          console.log(`${contact.name} did not pick up - trying the next contact.`);
        }

        // Last resort: emergency services, only if the user turned this on
        const call112On = (await SecureStore.getItemAsync("call112")) === "1";
        if (call112On && !someoneAnswered && !unsure && !stopCallingRef.current) {
          try {
            await attemptWithRetry(() => placeSilentCall(EMERGENCY_NUMBER));
            setCalled112(true);
          } catch (err) {
            console.warn("Could not call 112:", err);
          }
        }
      };

      // Task B: get the location, save it to the alert, then text every opted-in contact
      const smsTask = async () => {
        const location = await getCurrentLocation();

        if (location) {
          await alertReadyRef.current;
          const id = alertIdRef.current;
          if (id) {
            try {
              await axios.patch(
                `${BASE_URL}/alerts/${id}`,
                { latitude: location.lat, longitude: location.lng },
                { headers, timeout: 8000 }
              );
            } catch (err) {
              console.warn("Could not save location to alert:", err);
            }
          }
        }

        // Wait briefly for the alert record so the SMS can carry the live-tracking link
        await Promise.race([alertReadyRef.current, sleep(4000)]);
        const trackLink = alertTokenRef.current
          ? `${BASE_URL.replace(/\/api\/?$/, "")}/track/${alertTokenRef.current}`
          : null;

        const mapLink = location
          ? `https://maps.google.com/?q=${location.lat},${location.lng}${location.isLastKnown ? " (last known location)" : ""}`
          : "location unavailable";

        const smsRecipients = contacts.filter((c) => c.receives_sms);

        for (const contact of smsRecipients) {
          const message = contact.receives_live_location
            ? trackLink
              ? `SOS ALERT: I may need immediate help. Follow me live: ${trackLink}\nMap: ${mapLink}`
              : `SOS ALERT: I may need immediate help. My location: ${mapLink}`
            : `SOS ALERT: I may need immediate help. This is an automated message from SafeShield.`;

          try {
            await attemptWithRetry(() => sendSilentSms(contact.phone, message));
            reached.add(contact.id);
            logAction(contact.id, "sms", "sent");
          } catch (smsErr) {
            console.warn(`SMS to ${contact.name} failed:`, smsErr);
            logAction(contact.id, "sms", "failed");
          }
        }
      };

      // The calls can take minutes (each one is waited on), so don't make the
      // screen and the live location wait for them. Start the call sequence, wait
      // only for the SMS, then move on to monitoring while the calls carry on.
      const callPromise = callTask().catch((err) => console.warn("Call sequence error:", err));
      await smsTask().catch((err) => console.warn("SMS task error:", err));

      setNotifiedCount(reached.size);
      setState("MONITORING");
      updateAlertStatus("monitoring");

      await callPromise;
      setNotifiedCount(reached.size);
    })();
  }, [state]);

  // MONITORING - send an updated location every 30 seconds
  useEffect(() => {
    if (state !== "MONITORING") return;

    const interval = setInterval(async () => {
      const id = alertIdRef.current;
      if (!id) return;

      const location = await getCurrentLocation();
      if (!location) return;

      try {
        const headers = await authHeader();
        await axios.patch(
          `${BASE_URL}/alerts/${id}`,
          { latitude: location.lat, longitude: location.lng },
          { headers, timeout: 8000 }
        );
        console.log("Live location updated:", location.lat, location.lng);
      } catch (err) {
        console.warn("Could not update live location:", err);
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [state]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      // isInternetReachable is null while Android is still checking - treat that as online
      setIsOnline(!!netState.isConnected && netState.isInternetReachable !== false);
    });
    return () => unsubscribe();
  }, []);

  // When the connection comes back, send any alert that couldn't be created earlier
  useEffect(() => {
    if (!isOnline) return;

    (async () => {
      const pending = await getPendingAlert();
      if (!pending) return;
      await clearPendingAlert(); // take it out first so it can't be sent twice

      try {
        const headers = await authHeader();
        const { data } = await axios.post(`${BASE_URL}/alerts`, pending, { headers, timeout: 8000 });
        console.log("Successfully sent queued offline alert:", data.alert.id);
        // Note: this creates the alert record after the fact, so the backend
        // at least has a record of what happened.
      } catch (err) {
        console.warn("Retry failed, will try again next time online:", err);
        await savePendingAlert(pending);
      }
    })();
  }, [isOnline]);

  // Shake-to-SOS while this screen is open. When Protection mode is on, the Android service
  // does the detecting instead, so only one detector runs.
  useFocusEffect(
    useCallback(() => {
      if (state !== "IDLE" || protectionOn) return;

      let subscription: { remove: () => void } | null = null;
      let cancelled = false;
      const readyAt = Date.now() + SHAKE_GRACE_MS;

      (async () => {
        const level = await getSensitivity();
        if (cancelled) return;
        const feed = createShakeDetector(level, () => handleTriggerSOS("shake"));
        Accelerometer.setUpdateInterval(50);
        subscription = Accelerometer.addListener(({ x, y, z }) => {
          const now = Date.now();
          if (now < readyAt) return;
          feed(x, y, z, now);
        });
      })();

      return () => {
        cancelled = true;
        subscription?.remove();
      };
    }, [state, protectionOn, sensitivity])
  );

  // Protection mode opened the app after a shake: start the SOS countdown
  useEffect(() => {
    if ((trigger === "shake" || trigger === "voice") && state === "IDLE") handleTriggerSOS(trigger);
  }, [trigger, t]);

  // Refresh Protection mode status whenever this screen is shown or the app returns from Settings
  useFocusEffect(
    useCallback(() => {
      const refresh = async () => {
        await restoreProtectionIfEnabled();
        await restoreVoiceIfEnabled();
        setProtectionOn(await isProtectionRunning());
        setMissingSetup(await getMissingSetup());
        setDeviceLocked(await isDeviceLocked());
        setSensitivityState(await getSensitivity());
        setHasKeyword(!!(await SecureStore.getItemAsync("sosKeyword")));
      };
      refresh();
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") refresh();
      });
      return () => sub.remove();
    }, [])
  );

  async function handleSensitivity(level: Sensitivity) {
    setSensitivityState(level);
    await setSensitivity(level);
  }

  async function handleProtectionToggle(on: boolean) {
    try {
      if (on) {
        await startProtection();
        setProtectionOn(true);
        const missing = await getMissingSetup();
        setMissingSetup(missing);
        if (missing.length > 0) handleFinishSetup(missing);
      } else {
        await stopProtection();
        setProtectionOn(false);
      }
    } catch (err: any) {
      Alert.alert("Protection mode", err?.message || "Could not change Protection mode.");
    }
  }

  function handleFinishSetup(missing: MissingSetup[] = missingSetup) {
    const next = missing[0];
    if (next === "overlay") {
      Alert.alert(
        "Allow display over other apps",
        "This lets SafeShield open the SOS screen when your phone is locked. On the next screen, turn SafeShield on.",
        [{ text: "Later", style: "cancel" }, { text: "Open settings", onPress: openOverlaySettings }]
      );
    } else if (next === "battery") {
      Alert.alert(
        "Keep SafeShield running",
        "Allow SafeShield to run in the background so Protection mode isn't stopped to save battery. On Realme and Vivo phones also allow Auto-start for SafeShield in the phone's app settings.",
        [{ text: "Later", style: "cancel" }, { text: "Allow", onPress: requestBatteryExemption }]
      );
    }
  }

  function handleTriggerSOS(triggerType: TriggerType = "manual") {
    triggerTypeRef.current = triggerType;
    setState("TRIGGERED");
  }

  function handleSendNow() {
    setState("ACTIVE");
  }

  async function handleCancelAttempt() {
    if (pinInput.length < 4) {
      Alert.alert("Enter PIN", "Please enter your SOS PIN or cancel word to cancel.");
      return;
    }

    // Check what is saved on this phone first (PIN or cancel word), so cancelling works with no internet
    const typed = pinInput.trim();
    const localPin = await SecureStore.getItemAsync("sosPin");
    const localWord = await SecureStore.getItemAsync("sosKeyword");
    if (localPin || localWord) {
      const matches =
        (!!localPin && typed === localPin) ||
        (!!localWord && typed.toLowerCase() === localWord.toLowerCase());
      if (matches) {
        setState("CANCELLED");
        setPinInput("");
        updateAlertStatus("cancelled");
      } else {
        Alert.alert("Incorrect", "That doesn't match your PIN or cancel word. Try again.");
      }
      return;
    }

    // No saved copy yet (PIN was set before this update): check with the server
    try {
      const headers = await authHeader();
      const { data } = await axios.post(`${BASE_URL}/auth/verify-pin`, { pin: pinInput }, { headers });

      if (data.valid) {
        setState("CANCELLED");
        setPinInput("");
        updateAlertStatus("cancelled");
      } else {
        Alert.alert("Incorrect PIN", "That PIN doesn't match. Try again.");
      }
    } catch (err: any) {
      if (err?.response?.status === 400) {
        Alert.alert("No PIN set", "Set your SOS PIN from the Contacts screen first.");
      } else {
        Alert.alert("Error", "Could not verify PIN. Check your connection.");
      }
    }
  }

  // True if the typed text is the saved PIN or cancel word (works offline), else asks the server
  async function checkCredential(typed: string): Promise<boolean> {
    const entered = typed.trim();
    const localPin = await SecureStore.getItemAsync("sosPin");
    const localWord = await SecureStore.getItemAsync("sosKeyword");
    if (localPin || localWord) {
      return (
        (!!localPin && entered === localPin) ||
        (!!localWord && entered.toLowerCase() === localWord.toLowerCase())
      );
    }
    const headers = await authHeader();
    const { data } = await axios.post(`${BASE_URL}/auth/verify-pin`, { pin: entered }, { headers });
    return !!data.valid;
  }

  async function handleConfirmEnd() {
    if (pinInput.trim().length < 4) {
      Alert.alert("Enter PIN", "Please enter your SOS PIN or cancel word.");
      return;
    }
    try {
      if (await checkCredential(pinInput)) {
        setPinInput("");
        setShowEndCheck(false);
        handleEndSession();
      } else {
        Alert.alert("Incorrect", "That doesn't match your PIN or cancel word. Try again.");
      }
    } catch (err) {
      Alert.alert("Error", "Could not check your PIN. Check your connection.");
    }
  }

  function handleEndSession() {
    stopCallingRef.current = true;
    setState("COMPLETED");
    updateAlertStatus("completed");
  }

  function handleLogout() {
    Alert.alert(
      "Log out?",
      "SOS will not work on this phone until you log in again, and logging in needs internet.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out",
          style: "destructive",
          onPress: async () => {
            await SecureStore.deleteItemAsync("authToken");
            await SecureStore.deleteItemAsync("sosPin");
            await SecureStore.deleteItemAsync("sosKeyword");
            await SecureStore.deleteItemAsync("call112");
            await clearOfflineData();
            router.replace("/");
          },
        },
      ]
    );
  }

  function handleBackToIdle() {
    stopCallingRef.current = true;
    setShowEndCheck(false);
    setState("IDLE");
    setPinInput("");
    setNotifiedCount(0);
    setCalled112(false);
    alertIdRef.current = null;
    alertTokenRef.current = null;
    alertReadyRef.current = Promise.resolve();
  }

  async function savePendingAlert(data: any) {
    await SecureStore.setItemAsync("pendingAlert", JSON.stringify(data));
  }

  async function getPendingAlert(): Promise<any | null> {
    const raw = await SecureStore.getItemAsync("pendingAlert");
    return raw ? JSON.parse(raw) : null;
  }

  async function clearPendingAlert() {
    await SecureStore.deleteItemAsync("pendingAlert");
  }

  return (
    <View style={styles.container}>
      {__DEV__ && <Text style={styles.debugState}>State: {state}</Text>}

      <Text style={[styles.networkStatus, { color: isOnline ? "#2E7D32" : "#D32F2F" }]}>
        {isOnline ? "● Online" : "● Offline"}
      </Text>

      {state === "IDLE" && (
        <View style={styles.center}>
          <Pressable style={styles.sosButton} onPress={() => handleTriggerSOS("manual")}>
            <Text style={styles.sosButtonText}>SOS</Text>
          </Pressable>
          <View style={styles.protectionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.protectionTitle}>Protection mode</Text>
              <Text style={styles.protectionHint}>
                {protectionOn
                  ? "On: shake firmly to send SOS, even when the phone is locked"
                  : "Off: shake only works while this screen is open"}
              </Text>
            </View>
            <Switch value={protectionOn} onValueChange={handleProtectionToggle} />
          </View>
          {protectionOn && missingSetup.length > 0 && (
            <Pressable onPress={() => handleFinishSetup()}>
              <Text style={styles.setupLink}>
                Finish setup: {missingSetup.map((m) => (m === "overlay" ? "Display over other apps" : "Battery: Unrestricted")).join(", ")}
              </Text>
            </Pressable>
          )}
          <View style={styles.sensRow}>
            <Text style={styles.sensLabel}>Shake sensitivity</Text>
            {(["low", "medium", "high"] as Sensitivity[]).map((lvl) => (
              <Pressable
                key={lvl}
                style={[styles.sensChip, sensitivity === lvl && styles.sensChipOn]}
                onPress={() => handleSensitivity(lvl)}
              >
                <Text style={[styles.sensChipText, sensitivity === lvl && styles.sensChipTextOn]}>
                  {lvl === "low" ? "Low" : lvl === "medium" ? "Medium" : "High"}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sensHint}>Low = hardest to trigger (best if you jog or take stairs a lot)</Text>
          {!deviceLocked && (
            <View style={styles.footerLinks}>
              <Pressable onPress={() => router.push("/contacts")}>
                <Text style={styles.footerLink}>Contacts & PIN</Text>
              </Pressable>
              <Pressable onPress={() => router.push("/voice")}>
                <Text style={styles.footerLink}>Voice trigger</Text>
              </Pressable>
              <Pressable onPress={handleLogout}>
                <Text style={styles.footerLink}>Log out</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {state === "VERIFYING" && (
        <View style={styles.center}>
          <Text style={styles.countdownText}>Sending SOS in {secondsLeft}s</Text>
          <TextInput
            style={styles.pinInput}
            placeholder={hasKeyword ? "PIN or cancel word" : "Enter PIN to cancel"}
            value={pinInput}
            onChangeText={setPinInput}
            secureTextEntry
            keyboardType={hasKeyword ? "default" : "number-pad"}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable style={styles.cancelButton} onPress={handleCancelAttempt}>
            <Text style={styles.buttonText}>Cancel with PIN</Text>
          </Pressable>
          <Pressable style={styles.sendNowButton} onPress={handleSendNow}>
            <Text style={styles.buttonText}>Send SOS Now</Text>
          </Pressable>
        </View>
      )}

      {state === "CANCELLED" && (
        <View style={styles.center}>
          <Text style={styles.resultText}>SOS Cancelled</Text>
          <Pressable style={styles.cancelButton} onPress={handleBackToIdle}>
            <Text style={styles.buttonText}>Back to Home</Text>
          </Pressable>
        </View>
      )}

      {state === "COMMUNICATING" && (
        <View style={styles.center}>
          <Text style={styles.resultText}>Sending alerts...</Text>
          <Text style={styles.subText}>Contacting your emergency contacts.</Text>
        </View>
      )}

      {state === "MONITORING" && (
        <View style={styles.center}>
          <Text style={styles.resultText}>
            {notifiedCount > 0 || called112 ? "Alert sent" : "Alert could not be sent"}
          </Text>
          <Text style={styles.subText}>
            {notifiedCount > 0 || called112
              ? `${notifiedCount > 0 ? `Notified ${notifiedCount} contact${notifiedCount === 1 ? "" : "s"}. ` : ""}${called112 ? "112 was also called. " : ""}Your location keeps updating.`
              : "We couldn't reach your contacts automatically. Please call someone you trust."}
          </Text>
          {!showEndCheck ? (
            <Pressable style={styles.cancelButton} onPress={() => setShowEndCheck(true)}>
              <Text style={styles.buttonText}>I'm safe now</Text>
            </Pressable>
          ) : (
            <View style={styles.center}>
              <TextInput
                style={styles.pinInput}
                placeholder={hasKeyword ? "PIN or cancel word" : "Enter PIN to confirm"}
                value={pinInput}
                onChangeText={setPinInput}
                secureTextEntry
                keyboardType={hasKeyword ? "default" : "number-pad"}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable style={styles.cancelButton} onPress={handleConfirmEnd}>
                <Text style={styles.buttonText}>Confirm I'm safe</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      {state === "COMPLETED" && (
        <View style={styles.center}>
          <Text style={styles.resultText}>Session ended</Text>
          <Pressable style={styles.cancelButton} onPress={handleBackToIdle}>
            <Text style={styles.buttonText}>Back to Home</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff", padding: 24 },
  debugState: { position: "absolute", top: 60, color: "#999", fontFamily: "monospace" },
  center: { alignItems: "center", width: "100%" },
  sosButton: {
    width: 220, height: 220, borderRadius: 110, backgroundColor: "#D32F2F",
    justifyContent: "center", alignItems: "center", elevation: 6,
  },
  sosButtonText: { color: "#fff", fontSize: 48, fontWeight: "800" },
  countdownText: { fontSize: 28, fontWeight: "700", marginBottom: 20, color: "#D32F2F" },
  pinInput: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14, fontSize: 18, width: "80%", marginBottom: 16, textAlign: "center" },
  cancelButton: { backgroundColor: "#2E7D32", padding: 16, borderRadius: 12, width: "80%", marginBottom: 10 },
  sendNowButton: { backgroundColor: "#D32F2F", padding: 16, borderRadius: 12, width: "80%" },
  buttonText: { color: "#fff", textAlign: "center", fontSize: 18, fontWeight: "600" },
  resultText: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  subText: { color: "#555", marginBottom: 20, textAlign: "center" },
  protectionRow: { flexDirection: "row", alignItems: "center", width: "90%", marginTop: 32 },
  protectionTitle: { fontSize: 16, fontWeight: "700", color: "#222" },
  protectionHint: { fontSize: 12, color: "#666", marginTop: 2 },
  sensRow: { flexDirection: "row", alignItems: "center", width: "90%", marginTop: 18, gap: 8 },
  sensLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: "#222" },
  sensChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: "#B0295E" },
  sensChipOn: { backgroundColor: "#B0295E" },
  sensChipText: { color: "#B0295E", fontSize: 13, fontWeight: "600" },
  sensChipTextOn: { color: "#fff" },
  sensHint: { fontSize: 11, color: "#777", marginTop: 6, width: "90%" },
  setupLink: { color: "#D32F2F", fontSize: 13, fontWeight: "600", marginTop: 10, textAlign: "center" },
  footerLinks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 20, marginTop: 40 },
  footerLink: { color: "#B0295E", fontSize: 15, fontWeight: "600" },
  networkStatus: { position: "absolute", top: 85, fontSize: 12, fontWeight: "600" },
});