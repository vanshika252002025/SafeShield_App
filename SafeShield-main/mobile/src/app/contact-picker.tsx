import React, { useEffect, useState } from "react";
import { View, Text, TextInput, FlatList, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as Contacts from "expo-contacts/legacy";

type PhoneContact = {
  id: string;
  name: string;
  phone: string;
};

export default function ContactPickerScreen() {
  const router = useRouter();
  const [allContacts, setAllContacts] = useState<PhoneContact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        setLoading(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      const withPhones: PhoneContact[] = data
        .filter((c) => c.name && c.phoneNumbers && c.phoneNumbers.length > 0)
        .map((c) => ({
          id: c.id || Math.random().toString(),
          name: c.name || "Unknown",
          phone: c.phoneNumbers![0].number?.replace(/\s/g, "") || "",
        }));

      // Sort alphabetically for easier browsing
      withPhones.sort((a, b) => a.name.localeCompare(b.name));

      setAllContacts(withPhones);
      setLoading(false);
    })();
  }, []);

  const filtered = allContacts.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleSelect(contact: PhoneContact) {
    router.replace({
      pathname: "/contacts",
      params: { pickedName: contact.name, pickedPhone: contact.phone },
    });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#B0295E" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Select a Contact</Text>
      <TextInput
        style={styles.searchInput}
        placeholder="Search contacts..."
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => handleSelect(item)}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.phone}>{item.phone}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No contacts found.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 60, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 16, color: "#B0295E" },
  searchInput: { borderWidth: 1, borderColor: "#ccc", borderRadius: 10, padding: 12, fontSize: 16, marginBottom: 16 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" },
  name: { fontSize: 16, fontWeight: "600" },
  phone: { fontSize: 14, color: "#666" },
  emptyText: { textAlign: "center", color: "#999", marginTop: 40 },
});