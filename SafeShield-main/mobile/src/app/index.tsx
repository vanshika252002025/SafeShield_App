import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";

export default function WelcomeScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // Already logged in? Go straight to the SOS screen. This only reads the token
  // saved on the phone, so it works with no internet.
  useEffect(() => {
    SecureStore.getItemAsync("authToken")
      .then((token) => {
        if (token) router.replace("/sos");
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  if (checking) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>SafeShield</Text>
      <Text style={styles.subtitle}>
        An inclusive safety platform for people of all ages and genders.
      </Text>

      <Pressable style={styles.button} onPress={() => router.push("/account")}>
        <Text style={styles.buttonText}>Get Started</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 34, fontWeight: "700", color: "#B0295E", marginBottom: 12 },
  subtitle: { fontSize: 16, textAlign: "center", color: "#444", marginBottom: 40 },
  button: { backgroundColor: "#B0295E", paddingVertical: 14, paddingHorizontal: 32, borderRadius: 12 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});