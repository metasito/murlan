import { requireOptionalNativeModule } from "expo";

export interface MurlanAudioSession {
  outputLatencyMs(): number;
  ioBufferMs(): number;
  preferLowLatency(): void;
}

export default requireOptionalNativeModule<MurlanAudioSession>("MurlanAudioSession");
