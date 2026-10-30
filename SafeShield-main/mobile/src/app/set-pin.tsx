import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { BASE_URL } from "../config";

export default function SetPinScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [word, setWord] = useState("");
  const [hasWord, setHasWord] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync("sosKeyword").then((w) => setHasWord(!!w));
  }, []);

  function finish(message: string) {
    Alert.alert("Saved", message, [
      {
        text: "OK",
        onPress: () => (next === "back" ? router.back() : router.replace("/permissions")),
      },
    ]);
  }

  async function removeWord() {
    await SecureStore.deleteItemAsync("sosKeyword");
    setHasWord(false);
    Alert.alert("Removed", "Your cancel word was removed. Your PIN still works.");
  }

  async function handleSave() {
    const wantsPin = pin.length > 0 || confirmPin.length > 0;
    const newWord = word.trim();
    const existingPin = await SecureStore.getItemAsync("sosPin");

    if (!wantsPin && !newWord) {
      Alert.alert("Nothing to save", "Enter a new PIN, a cancel word, or both.");
      return;
    }
    if (!wantsPin && !existingPin) {
      Alert.alert("Enter your PIN too", "A PIN is required. Enter it in both PIN boxes, then add a cancel word if you like.");
      return;
    }
    if (wantsPin) {
      if (!/^\d{4,6}$/.test(pin)) {
        Alert.alert("Invalid PIN", "Your PIN must be 4 to 6 digits.");
        return;
      }
      if (pin !== confirmPin) {
        Alert.alert("PINs don't match", "Please enter the same PIN in both boxes.");
        return;
      }
    }
    if (newWord) {
      if (newWord.length < 4) {
        Alert.alert("Cancel word too short", "Use at least 4 characters.");
        return;
      }
      const pinToCompare = wantsPin ? pin : existingPin;
      if (pinToCompare && newWord === pinToCompare) {
        Alert.alert("Choose a different word", "The cancel word must be different from your PIN.");
        return;
      }
    }

    setLoading(true);
    try {
      if (wantsPin) {
        const token = await SecureStore.getItemAsync("authToken");
        await axios.post(
          `${BASE_URL}/auth/set-pin`,
          { pin },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        await SecureStore.setItemAsync("sosPin", pin);
      }
      if (newWord) {
        await SecureStore.setItemAsync("sosKeyword", newWord);
      }
      finish("You can cancel an SOS alert with your PIN" + (newWord || hasWord ? " or your cancel word." : "."));
    } catch (err: any) {
      const message = err?.response?.data?.error || "Could not save. Check your connection and try again.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>SOS PIN & cancel word</Text>
      <Text style={styles.subtitle}>
        Either one cancels an SOS alert, so nobody holding your phone can switch it off.
      </Text>

      <Text style={styles.label}>PIN (4-6 digits)</Text>
      <TextInput
        style={styles.input}
        placeholder="New PIN"
        value={pin}
        onChangeText={setPin}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
      />
      <TextInput
        style={styles.input}
        placeholder="Confirm PIN"
        value={confirmPin}
        onChangeText={setConfirmPin}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
      />

      <Text style={styles.label}>Cancel word (optional)</Text>
      <Text style={styles.hint}>
        A word or phrase only you know, at least 4 characters. Capital letters don't matter.
        {hasWord ? " One is already set. Type a new one to replace it." : ""}
      </Text>
      <TextInput
        style={styles.input}
        placeholder={hasWord ? "New cancel word" : "Cancel word"}
        value={word}
        onChangeText={setWord}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      {hasWord && (
        <Pressable onPress={removeWord}>
          <Text style={styles.removeLink}>Remove my cancel word</Text>
        </Pressable>
      )}

      <Pressable style={styles.button} onPress={handleSave} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Saving..." : "Save"}</Text>
      </Pressable>

      {next === "back" && (
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", marginBottom: 12, color: "#B0295E" },
  subtitle: { fontSize: 15, textAlign: "center", color: "#444", marginBottom: 24 },
  label: { fontSize: 16, fontWeight: "700", color: "#222", marginBottom: 6 },
  hint: { fontSize: 13, color: "#666", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12 },
  removeLink: { color: "#D32F2F", fontWeight: "600", marginBottom: 12 },
  button: { backgroundColor: "#B0295E", padding: 16, borderRadius: 12, marginTop: 8 },
  buttonText: { color: "#fff", textAlign: "center", fontSize: 18, fontWeight: "600" },
  link: { textAlign: "center", marginTop: 16, color: "#B0295E" },
});