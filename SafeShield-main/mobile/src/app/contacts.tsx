import React, { useEffect, useState, useCallback } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, Alert, Switch } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { saveContactsCache } from "../services/secureCache";
import { BASE_URL } from "../config";

type Contact = {
  id: number;
  name: string;
  phone: string;
  relation: string | null;
  receives_sms: boolean;
  receives_live_location: boolean;
  is_primary_call: boolean;
  call_order: number;
};

async function authHeader() {
  const token = await SecureStore.getItemAsync("authToken");
  return { Authorization: `Bearer ${token}` };
}

// Accepts spaces, dashes and a +91 / 91 / 0 prefix.
// Returns +91XXXXXXXXXX for a valid Indian mobile number, otherwise null.
function normalizeIndianMobile(raw: string): string | null {
  let digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+91")) digits = digits.slice(3);
  else if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

export default function ContactsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ pickedName?: string; pickedPhone?: string }>();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState("");
  const [loading, setLoading] = useState(false);
  const [call112, setCall112] = useState(false);

  const loadContacts = useCallback(async () => {
    try {
      const headers = await authHeader();
      const { data } = await axios.get(`${BASE_URL}/contacts`, { headers });
      setContacts(data.contacts);
      // Encrypted copy for the SOS screen to use when there is no internet
      saveContactsCache(data.contacts).catch(() => {});
    } catch (err) {
      Alert.alert("Error", "Could not load contacts.");
    }
  }, []);

  useEffect(() => {
    loadContacts();
    SecureStore.getItemAsync("call112").then((v) => setCall112(v === "1"));
  }, [loadContacts]);

  function toggle112(on: boolean) {
    if (!on) {
      setCall112(false);
      SecureStore.setItemAsync("call112", "0");
      return;
    }
    Alert.alert(
      "Also call 112?",
      "If none of your call contacts answer, SheShield will call 112 for you. Every SOS, including a false alarm, can then reach emergency services, and misuse can get your number blocked. Turn this on only when you want that.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn on",
          onPress: () => {
            setCall112(true);
            SecureStore.setItemAsync("call112", "1");
          },
        },
      ]
    );
  }

  useEffect(() => {
    if (params.pickedName) setName(params.pickedName);
    if (params.pickedPhone) setPhone(params.pickedPhone);
  }, [params.pickedName, params.pickedPhone]);

  async function handleAddContact() {
    if (!name.trim() || !phone.trim()) {
      return Alert.alert("Missing info", "Please enter a name and phone number.");
    }

    const normalizedPhone = normalizeIndianMobile(phone);
    if (!normalizedPhone) {
      return Alert.alert(
        "Invalid number",
        "Enter a valid 10-digit Indian mobile number (it starts with 6, 7, 8 or 9), with or without +91."
      );
    }

    setLoading(true);
    try {
      const headers = await authHeader();
      await axios.post(
        `${BASE_URL}/contacts`,
        { name: name.trim(), phone: normalizedPhone, relation: relation.trim() || null },
        { headers }
      );
      setName("");
      setPhone("");
      setRelation("");
      loadContacts();
    } catch (err) {
      Alert.alert("Error", "Could not add contact.");
    } finally {
      setLoading(false);
    }
  }

  async function updateContact(id: number, changes: Partial<Contact>) {
    try {
      const headers = await authHeader();
      await axios.put(`${BASE_URL}/contacts/${id}`, changes, { headers });
      loadContacts();
    } catch (err) {
      Alert.alert("Error", "Could not update contact.");
    }
  }

  async function deleteContact(id: number) {
    try {
      const headers = await authHeader();
      await axios.delete(`${BASE_URL}/contacts/${id}`, { headers });
      loadContacts();
    } catch (err) {
      Alert.alert("Error", "Could not remove contact.");
    }
  }

  function confirmDelete(contact: Contact) {
    Alert.alert("Remove contact", `Remove ${contact.name} from your emergency contacts?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => deleteContact(contact.id) },
    ]);
  }

  function handlePickFromPhone() {
    router.push("/contact-picker");
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={contacts}
        keyExtractor={(item) => item.id.toString()}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<Text style={styles.title}>Emergency Contacts</Text>}
        renderItem={({ item }) => (
          <View style={styles.contactRow}>
            <Text style={styles.contactName}>{item.name}</Text>
            <Text style={styles.contactDetail}>{item.phone}{item.relation ? ` — ${item.relation}` : ""}</Text>

            <View style={styles.prefRow}>
              <Text style={styles.prefLabel}>Send SMS</Text>
              <Switch
                value={item.receives_sms}
                onValueChange={(val) => updateContact(item.id, { receives_sms: val })}
              />
            </View>

            <View style={styles.prefRow}>
              <Text style={styles.prefLabel}>Share live location</Text>
              <Switch
                value={item.receives_live_location}
                onValueChange={(val) => updateContact(item.id, { receives_live_location: val })}
              />
            </View>

            <View style={styles.prefRow}>
              <Text style={styles.prefLabel}>Primary call contact</Text>
              <Switch
                value={item.is_primary_call}
                onValueChange={(val) => updateContact(item.id, { is_primary_call: val })}
              />
            </View>

            {!item.is_primary_call && (
              <View style={styles.prefRow}>
                <Text style={styles.prefLabel}>
                  {item.call_order > 0
                    ? `Will be called: backup #${item.call_order}`
                    : "Won't be called automatically"}
                </Text>
                <Pressable
                  style={styles.smallButton}
                  onPress={() => {
                    const nextOrder = item.call_order > 0 ? 0 : contacts.filter((c) => c.call_order > 0).length + 1;
                    updateContact(item.id, { call_order: nextOrder });
                  }}
                >
                  <Text style={styles.smallButtonText}>
                    {item.call_order > 0 ? "Remove from list" : "Add to call list"}
                  </Text>
                </Pressable>
              </View>
            )}

            <Pressable onPress={() => confirmDelete(item)}>
              <Text style={styles.deleteText}>Remove contact</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No contacts added yet.</Text>}
        ListFooterComponent={
          <View style={{ marginTop: 20 }}>
            <Pressable style={styles.secondaryButton} onPress={handlePickFromPhone}>
              <Text style={styles.secondaryButtonText}>📱 Pick from phone contacts</Text>
            </Pressable>

            <Text style={styles.subtitle}>Add a contact</Text>
            <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} />
            <TextInput
              style={styles.input}
              placeholder="Phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextInput
              style={styles.input}
              placeholder="Relation (optional)"
              value={relation}
              onChangeText={setRelation}
            />

            <Pressable style={styles.button} onPress={handleAddContact} disabled={loading}>
              <Text style={styles.buttonText}>{loading ? "Adding..." : "Add Contact"}</Text>
            </Pressable>

            <View style={styles.serviceBox}>
              <View style={{ flex: 1 }}>
                <Text style={styles.serviceTitle}>Also call 112</Text>
                <Text style={styles.serviceHint}>
                  If none of your call contacts answer. Leave this off while testing.
                </Text>
              </View>
              <Switch value={call112} onValueChange={toggle112} />
            </View>

            <Pressable
              style={[styles.secondaryButton, { marginTop: 16 }]}
              onPress={() => router.push({ pathname: "/set-pin", params: { next: "back" } })}
            >
              <Text style={styles.secondaryButtonText}>Set / change SOS PIN</Text>
            </Pressable>

            <Pressable style={styles.button} onPress={() => router.push("/sos")}>
              <Text style={styles.buttonText}>Continue to SOS Screen</Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, backgroundColor: "#fff", paddingTop: 60 },
  list: { flex: 1 },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 16, color: "#B0295E" },
  subtitle: { fontSize: 18, fontWeight: "600", marginBottom: 10 },
  contactRow: { paddingVertical: 10, borderBottomWidth: 1, borderColor: "#eee" },
  contactName: { fontSize: 16, fontWeight: "600" },
  contactDetail: { fontSize: 14, color: "#666" },
  emptyText: { color: "#999", fontStyle: "italic" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 10 },
  button: { backgroundColor: "#B0295E", padding: 16, borderRadius: 12, marginTop: 8 },
  buttonText: { color: "#fff", textAlign: "center", fontSize: 18, fontWeight: "600" },
  prefRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  prefLabel: { fontSize: 14, color: "#444" },
  secondaryButton: { backgroundColor: "#FFF3F7", padding: 14, borderRadius: 10, marginBottom: 16 },
  secondaryButtonText: { textAlign: "center", color: "#B0295E", fontWeight: "600" },
  smallButton: { backgroundColor: "#2E7D32", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  smallButtonText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  serviceBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFF3F7", borderRadius: 10, padding: 14, marginTop: 16 },
  serviceTitle: { fontSize: 15, fontWeight: "700", color: "#222" },
  serviceHint: { fontSize: 12, color: "#666", marginTop: 2 },
  deleteText: { color: "#D32F2F", marginTop: 10, fontWeight: "600" },
});