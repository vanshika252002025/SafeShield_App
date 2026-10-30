import React, { useState } from "react";
import { View, Text, Switch, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

export default function AccessibilityScreen() {
  const router = useRouter();
  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);

  function handleContinue() {
    console.log("Accessibility preferences:", { highContrast, largeText });
    // Phase 3 will persist these to the user's account once auth exists.
  }

  const baseTextSize = largeText ? 20 : 16;
  const bgColor = highContrast ? "#000" : "#fff";
  const textColor = highContrast ? "#fff" : "#222";

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      <Text style={[styles.title, { color: textColor }]}>Accessibility</Text>
      <Text style={[styles.subtitle, { color: textColor, fontSize: baseTextSize }]}>
        These settings help make SafeShield easier to see and use. You can change them anytime later.
      </Text>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: textColor, fontSize: baseTextSize }]}>
            High-contrast mode
          </Text>
          <Text style={[styles.rowHint, { color: textColor, fontSize: baseTextSize - 4 }]}>
            Stronger black/white contrast for better visibility.
          </Text>
        </View>
        <Switch value={highContrast} onValueChange={setHighContrast} />
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: textColor, fontSize: baseTextSize }]}>
            Large text
          </Text>
          <Text style={[styles.rowHint, { color: textColor, fontSize: baseTextSize - 4 }]}>
            Increases text size throughout the app.
          </Text>
        </View>
        <Switch value={largeText} onValueChange={setLargeText} />
      </View>

      <Pressable
        style={[styles.button, { backgroundColor: highContrast ? "#fff" : "#B0295E" }]}
        onPress={handleContinue}
      >
        <Text style={[styles.buttonText, { color: highContrast ? "#000" : "#fff" }]}>
          Continue
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", marginBottom: 12 },
  subtitle: { textAlign: "center", marginBottom: 28 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: "#88888833",
  },
  rowLabel: { fontWeight: "600" },
  rowHint: { marginTop: 2, opacity: 0.7 },
  button: { padding: 16, borderRadius: 12, marginTop: 28 },
  buttonText: { textAlign: "center", fontSize: 18, fontWeight: "600" },
});