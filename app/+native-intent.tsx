const DIAGNOSTICS = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  if (DIAGNOSTICS && /^(murlan:\/\/|\/)?bench(\?|$)/.test(path)) return path.replace(/^murlan:\/\//, "/");
  return "/";
}
