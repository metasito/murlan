export function redirectSystemPath({
  path,
  initial,
}: { path: string; initial: boolean }) {
  // [RESEARCH-1259] never merged: the soak screen is reached only by its deep link.
  if (path.includes("soak1259")) return path;
  return '/';
}
