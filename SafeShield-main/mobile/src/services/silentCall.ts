import { NativeModules } from "react-native";

const { SilentCall } = NativeModules;

export type CallOutcome = {
  observed: boolean; // false when the phone-state permission is missing, so the call can't be watched
  started?: boolean; // the call actually began dialing
  ended?: boolean; // false = the call was still going when we stopped waiting
  totalSeconds?: number; // dialing + ringing + talking
  connectedSeconds?: number; // talk time from the call log, -1 if it couldn't be read
};

// Places the call immediately, with no dialer screen and no tap.
export async function placeSilentCall(phoneNumber: string): Promise<string> {
  return SilentCall.placeCall(phoneNumber);
}

// Waits for the call that was just placed to finish, then reports how it went.
export async function waitForCallEnd(
  phoneNumber: string,
  placedAtMs: number,
  maxWaitMs: number
): Promise<CallOutcome> {
  return SilentCall.waitForCallEnd(phoneNumber, placedAtMs, maxWaitMs);
}