import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Accelerometer } from "expo-sensors";

export default function SensorTestScreen() {
  const [data, setData] = useState({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    Accelerometer.setUpdateInterval(200);
    const subscription = Accelerometer.addListener((result) => {
      setData(result);
    });
    return () => subscription.remove();
  }, []);

  const magnitude = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2).toFixed(2);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Accelerometer Test</Text>
      <Text style={styles.value}>x: {data.x.toFixed(2)}</Text>
      <Text style={styles.value}>y: {data.y.toFixed(2)}</Text>
      <Text style={styles.value}>z: {data.z.toFixed(2)}</Text>
      <Text style={styles.magnitude}>magnitude: {magnitude}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 20 },
  value: { fontSize: 18, marginBottom: 6, fontFamily: "monospace" },
  magnitude: { fontSize: 22, fontWeight: "700", color: "#B0295E", marginTop: 12 },
});