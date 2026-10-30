import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Linking, PermissionsAndroid } from "react-native";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as Contacts from "expo-contacts";

import { requestRecordingPermissionsAsync } from "expo-audio";

type PermissionStep = {
  key: string;
  title: string;
  purpose: string;
  fallback: string;
  buttonLabel: string;
  onAllow: () => Promise<{ text: string; blocked: boolean }>;
};

export default function PermissionsScreen() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [resultText, setResultText] = useState("");
  const [isBlocked, setIsBlocked] = useState(false);

  const steps: PermissionStep[] = [
    {
      key: "location",
      title: "Location",
      purpose: "Used for SOS location, live location sharing, risk-zone warnings and safer routes.",
      fallback: "SOS alerts won't include your location, and risk warnings will be unavailable.",
      buttonLabel: "Allow Location",
      onAllow: async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        return { text: `Location permission: ${status}`, blocked: false };
      },
    },
    {
      key: "motion",
      title: "Motion Detection",
      purpose:
        "Used for shake-to-SOS and fall detection. Note: Android doesn't require a system permission for this - it's a feature you can turn on or off here.",
      fallback: "Shake-to-SOS and automatic fall detection will be turned off, but manual SOS still works fully.",
      buttonLabel: "Enable Motion Detection",
      onAllow: async () => {
        return { text: "Motion detection: enabled (preference saved)", blocked: false };
      },
    },
    {
      key: "microphone",
      title: "Microphone",
      purpose: "Used for the voice SOS keyword and optional audio evidence.",
      fallback: "Voice-activated SOS and audio evidence will be unavailable, but manual SOS still works fully.",
      buttonLabel: "Allow Microphone",
      onAllow: async () => {
        const { status } = await requestRecordingPermissionsAsync();
        return { text: `Microphone permission: ${status}`, blocked: false };
      },
    },
    {
      key: "contacts",
      title: "Contacts",
      purpose: "Lets you quickly pick emergency contacts from your phone's address book instead of typing them manually.",
      fallback: "You can still add emergency contacts by typing their name and number manually.",
      buttonLabel: "Allow Contacts Access",
      onAllow: async () => {
        const { status } = await Contacts.requestPermissionsAsync();
        return { text: `Contacts permission: ${status}`, blocked: false };
      },
    },
    {
      key: "call_phone",
      title: "Phone Calls",
      purpose:
        "Allows SafeShield to automatically call your primary emergency contact when SOS is confirmed - no extra tap needed. It also lets the app tell when a call has ended or was answered, so backup contacts are only called if nobody picks up.",
      fallback:
        "You'll need to manually open the dialer to call your contact during an emergency. Without the call-status permissions, backup contacts are called on a fixed timer instead.",
      buttonLabel: "Allow Phone Calls",
      onAllow: async () => {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CALL_PHONE,
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
          PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
        ]);
        const callResult = results[PermissionsAndroid.PERMISSIONS.CALL_PHONE];
        const stateResult = results[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE];
        const logResult = results[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG];
        return {
          text: `Phone call permission: ${callResult} | call status: ${stateResult} | call log: ${logResult}`,
          blocked: callResult === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
        };
      },
    },
    {
      key: "send_sms",
      title: "Send SMS",
      purpose: "Allows SafeShield to automatically text your emergency contacts with your location when SOS is confirmed - no extra tap needed.",
      fallback: "You'll need to manually open your messaging app to text your contacts during an emergency.",
      buttonLabel: "Allow SMS",
      onAllow: async () => {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS);
        return {
          text: `SMS permission: ${granted}`,
          blocked: granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
        };
      },
    },
  ];

  const current = steps[stepIndex];

  async function handleAllow() {
    const result = await current.onAllow();
    setResultText(result.text);
    setIsBlocked(result.blocked);

    const wasGranted = result.text.toLowerCase().includes("granted");
    if (wasGranted && !result.blocked) {
      // setTimeout(() => {
      //   handleNext();
      // }, 600);
    }
  }

  function handleOpenSettings() {
    Linking.openSettings();
  }

  function handleNext() {
    setResultText("");
    setIsBlocked(false);
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
    } else {
      router.push("/contacts");
    }
  }

  async function handleLogout() {
    await SecureStore.deleteItemAsync("authToken");
    router.replace("/");
  }

  return (
    <View style={styles.container}>
      <Pressable onPress={handleLogout} style={{ position: "absolute", top: 50, right: 20 }}>
        <Text style={{ color: "#888" }}>Log out</Text>
      </Pressable>
      <Text style={styles.step}>
        Permission {stepIndex + 1} of {steps.length}
      </Text>
      <Text style={styles.title}>{current.title}</Text>
      <Text style={styles.purpose}>{current.purpose}</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>If you say no:</Text>
        <Text style={styles.cardText}>{current.fallback}</Text>
      </View>

      {isBlocked ? (
        <>
          <Text style={styles.blockedText}>
            This permission was permanently denied. Android won't show the request dialog again —
            you'll need to enable it manually in Settings.
          </Text>
          <Pressable style={styles.button} onPress={handleOpenSettings}>
            <Text style={styles.buttonText}>Open App Settings</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={styles.button} onPress={handleAllow}>
          <Text style={styles.buttonText}>{current.buttonLabel}</Text>
        </Pressable>
      )}

      {resultText !== "" && <Text style={styles.resultText}>{resultText}</Text>}

      <Pressable style={styles.secondaryButton} onPress={handleNext}>
        <Text style={styles.secondaryButtonText}>
          {stepIndex < steps.length - 1 ? "Not now / Next" : "Continue"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  step: { textAlign: "center", color: "#888", marginBottom: 8 },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", marginBottom: 12 },
  purpose: { fontSize: 16, textAlign: "center", color: "#333", marginBottom: 20 },
  card: { backgroundColor: "#FFF3F7", borderRadius: 12, padding: 16, marginBottom: 24 },
  cardLabel: { fontWeight: "600", marginBottom: 4, color: "#B0295E" },
  cardText: { color: "#555" },
  button: { backgroundColor: "#B0295E", padding: 16, borderRadius: 12, marginBottom: 10 },
  buttonText: { color: "#fff", textAlign: "center", fontSize: 18, fontWeight: "600" },
  secondaryButton: { padding: 14 },
  secondaryButtonText: { color: "#888", textAlign: "center", fontSize: 16 },
  resultText: { textAlign: "center", marginTop: 16, color: "#2E7D32", fontWeight: "600" },
  blockedText: { textAlign: "center", color: "#B0295E", marginBottom: 12, fontSize: 14 },
});