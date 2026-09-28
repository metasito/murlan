import { TurboModuleRegistry, type TurboModule } from "react-native";

interface SourceCode extends TurboModule { getConstants(): { scriptURL: string } }

export function benchBuild(): { dev: boolean; scriptURL: string | null } {
  return { dev: __DEV__, scriptURL: TurboModuleRegistry.get<SourceCode>("SourceCode")?.getConstants().scriptURL ?? null };
}
