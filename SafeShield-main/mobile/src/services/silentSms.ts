import { NativeModules } from "react-native";

const { SilentSms } = NativeModules;

export async function sendSilentSms(phoneNumber: string, message: string): Promise<string> {
  return SilentSms.sendSms(phoneNumber, message);
}