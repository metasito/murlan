import { requireOptionalNativeModule } from "expo";

export interface MurlanDiagnostics {
  hostNowMs(): number;
  footprintMb(): number;
  /** `cpuMs` is cumulative process CPU time; `thermal` is ProcessInfo.ThermalState (0 nominal … 3 critical); `battery` is 0–1, or -1 when unknown. */
  systemState?(): { battery: number; charging: boolean; thermal: number; lowPower: boolean; maxFps: number; cpuMs: number; gpuMb: number };
  inputLatencyMs?(): number;
  startCapture?(mic: boolean): Promise<boolean>;
  stopCapture?(): Promise<boolean>;
  startMotion?(): boolean;
  stopMotion?(): void;
  drain?(): Record<string, string | number>[];
}

export default requireOptionalNativeModule<MurlanDiagnostics>("MurlanDiagnostics");
