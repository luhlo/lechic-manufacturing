import type { SupabaseClient } from "@supabase/supabase-js";
const storageKey = "lechic-manufacturing-pin-device";
export interface PinDevice {
  id: string;
  name: string;
  token: string;
  expires_at: string;
}
export function savedPinDevice(): PinDevice | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return value &&
      /^[0-9a-f]{64}$/.test(value.token) &&
      Date.parse(value.expires_at) > Date.now()
      ? value
      : null;
  } catch {
    return null;
  }
}
export function rememberPinDevice(device: PinDevice) {
  localStorage.setItem(storageKey, JSON.stringify(device));
}
export function forgetPinDevice() {
  localStorage.removeItem(storageKey);
}
export async function loginRequest<T>(
  client: SupabaseClient,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.functions.invoke("manufacturing-login", {
    body,
  });
  if (error) {
    let detail = "Could not reach the sign-in service. Please try again.";
    if (error.context instanceof Response) {
      try {
        detail = (await error.context.json()).error ?? detail;
      } catch {
        /* Network/gateway error. */
      }
    }
    throw Error(detail);
  }
  return data as T;
}
export async function loginWithUsername(
  client: SupabaseClient,
  username: string,
  password: string,
) {
  const tokens = await loginRequest<{
    access_token: string;
    refresh_token: string;
  }>(client, { action: "username", username, password });
  const { error } = await client.auth.setSession(tokens);
  if (error) throw error;
}
export async function loginWithPin(client: SupabaseClient, pin: string) {
  const device = savedPinDevice();
  if (!device) throw Error("Ask your manager to approve this device first.");
  const tokens = await loginRequest<{
    access_token: string;
    refresh_token: string;
  }>(client, { action: "pin", pin, device_token: device.token });
  const { error } = await client.auth.setSession(tokens);
  if (error) throw error;
}
