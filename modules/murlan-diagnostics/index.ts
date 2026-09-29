import { requireOptionalNativeModule } from "expo";

export interface MurlanDiagnostics {
  hostNowMs(): number;
  footprintMb(): number;
  outputLatencyMs?(): number;
  ioBufferMs?(): number;
  inputLatencyMs?(): number;
  startCapture?(mic: boolean): Promise<boolean>;
  stopCapture?(): Promise<boolean>;
  startMotion?(): boolean;
  stopMotion?(): void;
  drain?(): Record<string, string | number>[];
}

export default requireOptionalNativeModule<MurlanDiagnostics>("MurlanDiagnostics");
