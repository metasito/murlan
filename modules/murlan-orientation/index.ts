import { requireOptionalNativeModule } from "expo";

export interface MurlanOrientation {
  holdLandscape(): Promise<void>;
  release(): Promise<void>;
  snapshot(): Promise<Record<string, unknown>>;
}

export default requireOptionalNativeModule<MurlanOrientation>("MurlanOrientation");
