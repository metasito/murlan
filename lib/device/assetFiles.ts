import { Asset } from "expo-asset";

export async function localFiles(modules: number[]): Promise<string[]> {
  return (await Asset.loadAsync(modules)).map((a) => a.localUri ?? a.uri);
}
