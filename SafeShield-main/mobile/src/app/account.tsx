import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { BASE_URL } from "../config";

export default function AccountScreen() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);
    try {
      const endpoint = isSignUp ? "/auth/register" : "/auth/login";
      const body = isSignUp ? { name, email, password } : { email, password };

      const { data } = await axios.post(`${BASE_URL}${endpoint}`, body);

      await SecureStore.setItemAsync("authToken", data.token);

      router.push(isSignUp ? "/set-pin" : "/permissions");
    } catch (err: any) {
      const message = err?.response?.data?.error || "Something went wrong. Check your connection.";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isSignUp ? "Create Account" : "Log In"}</Text>

      {isSignUp && (
        <TextInput style={styles.input} placeholder="Full name" value={name} onChangeText={setName} />
      )}
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Pressable style={styles.button} onPress={handleSubmit} disabled={loading}>
        <Text style={styles.buttonText}>
          {loading ? "Please wait..." : isSignUp ? "Sign Up" : "Log In"}
        </Text>
      </Pressable>

      <Pressable onPress={() => setIsSignUp(!isSignUp)}>
        <Text style={styles.switchText}>
          {isSignUp ? "Already have an account? Log in" : "New here? Create an account"}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", marginBottom: 24, color: "#B0295E" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12 },
  button: { backgroundColor: "#B0295E", padding: 16, borderRadius: 12, marginTop: 8 },
  buttonText: { color: "#fff", textAlign: "center", fontSize: 18, fontWeight: "600" },
  switchText: { textAlign: "center", marginTop: 16, color: "#B0295E" },
});