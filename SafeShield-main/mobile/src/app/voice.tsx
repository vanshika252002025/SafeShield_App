import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Switch, Alert, ScrollView } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import {
  validatePhrase,
  getSavedPhrase,
  saveVoicePhrase,
  getVoiceStatus,
  startVoice,
  stopVoice,
  setVoiceTestMode,
} from "../services/voice";
import type { VoiceStatus } from "../services/voice";

export default function VoiceScreen() {
  const router = useRouter();
  const [phrase, setPhrase] = useState("");
  const [savedPhrase, setSavedPhrase] = useState("");
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [openedAt] = useState(Date.now());

  // While this screen is open the phrase only gets tested, it never sends a real SOS
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const saved = await getSavedPhrase();
        if (!alive) return;
        setSavedPhrase(saved);
        setPhrase(saved);
        await setVoiceTestMode(true);
      })();
      const timer = setInterval(async () => {
        const s = await getVoiceStatus();
        if (!alive) return;
        setStatus(s);
        setOn((prev) => (busy ? prev : s.running));
      }, 1000);
      return () => {
        alive = false;
        clearInterval(timer);
        setVoiceTestMode(false);
      };
    }, [busy])
  );

  async function handleSave() {
    const problem = validatePhrase(phrase);
    if (problem) {
      Alert.alert("Choose another phrase", problem);
      return;
    }
    const saved = await saveVoicePhrase(phrase);
    setSavedPhrase(saved);
    setPhrase(saved);
    Alert.alert("Saved", `Your phrase is "${saved}". Turn on listening, then say it twice to test it.`);
  }

  async function handleToggle(next: boolean) {
    setBusy(true);
    try {
      if (next) {
        await startVoice();
        setOn(true);
      } else {
        await stopVoice();
        setOn(false);
      }
    } catch (err: any) {
      setOn(false);
      Alert.alert("Voice trigger", err?.message || "Could not change the voice trigger.");
    } finally {
      setTimeout(() => setBusy(false), 2500);
    }
  }

  const recognised = !!status && status.lastHitAt > openedAt;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Voice trigger</Text>
      <Text style={styles.subtitle}>
        Say your phrase twice and SheShield sends an SOS straight away, with no countdown, even when the phone is
        locked.
      </Text>

      <Text style={styles.label}>Your phrase</Text>
      <Text style={styles.hint}>
        English words only, at least two words. Pick something you would never say by accident, for example "purple
        elephant tomorrow". Avoid ordinary phrases like "help me".
      </Text>
      <TextInput
        style={styles.input}
        placeholder="Your phrase"
        value={phrase}
        onChangeText={setPhrase}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable style={styles.button} onPress={handleSave}>
        <Text style={styles.buttonText}>Save phrase</Text>
      </Pressable>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Listen for my phrase</Text>
          <Text style={styles.hint}>Uses more battery. Your phone shows a microphone dot while this is on.</Text>
        </View>
        <Switch value={on} onValueChange={handleToggle} disabled={!savedPhrase} />
      </View>

      {on && (
        <View style={styles.statusBox}>
          <Text style={styles.statusTitle}>Test</Text>
          {!status?.ready ? (
            <Text style={styles.statusText}>Loading the voice model. The first start can take 10 to 20 seconds...</Text>
          ) : (
            <Text style={styles.statusText}>Listening. Say your phrase twice.</Text>
          )}
          {!!status?.lastHeard && <Text style={styles.statusText}>Heard: "{status.lastHeard}"</Text>}
          {recognised && (
            <Text style={styles.ok}>Phrase recognised. Outside this screen, this would send an SOS.</Text>
          )}
          {!!status?.error && <Text style={styles.err}>{status.error}</Text>}
          <Text style={styles.hint}>
            If it never recognises you, choose a simpler phrase made of ordinary words and try again. SOS is never
            sent while this screen is open.
          </Text>
        </View>
      )}

      <Text style={styles.note}>
        Your voice is processed on this phone only. Nothing is recorded or uploaded. Cancelling an SOS still needs
        your PIN or cancel word, because a spoken cancel could be heard by anyone nearby.
      </Text>

      <Pressable onPress={() => router.back()}>
        <Text style={styles.link}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 60, backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", color: "#B0295E", marginBottom: 10 },
  subtitle: { fontSize: 15, textAlign: "center", color: "#444", marginBottom: 24 },
  label: { fontSize: 16, fontWeight: "700", color: "#222", marginBottom: 4 },
  hint: { fontSize: 12, color: "#666", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12 },
  button: { backgroundColor: "#B0295E", padding: 14, borderRadius: 12, marginBottom: 24 },
  buttonText: { color: "#fff", textAlign: "center", fontSize: 17, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 16 },
  statusBox: { backgroundColor: "#FFF3F7", borderRadius: 12, padding: 14, marginBottom: 16 },
  statusTitle: { fontWeight: "700", marginBottom: 6, color: "#B0295E" },
  statusText: { fontSize: 14, color: "#333", marginBottom: 4 },
  ok: { fontSize: 14, color: "#2E7D32", fontWeight: "700", marginVertical: 6 },
  err: { fontSize: 13, color: "#D32F2F", marginTop: 4 },
  note: { fontSize: 12, color: "#666", marginVertical: 12 },
  link: { textAlign: "center", color: "#B0295E", marginTop: 8 },
});