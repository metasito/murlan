import { systemPath } from "@/lib/deepLink";
import { captureEnabled } from "@/lib/captureRoute";

const DIAGNOSTICS = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (DIAGNOSTICS && /^(murlan:\/\/|\/)?bench(\?|$)/.test(path)) return path.replace(/^murlan:\/\//, "/");
  if (captureEnabled() && /^(murlan:\/\/|\/)?capture(\?|$)/.test(path)) return `/${path.replace(/^(murlan:\/\/|\/)/, "")}`;
  return systemPath(path);
}
