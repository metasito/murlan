import native from "@/modules/murlan-diagnostics";
import { diag, type DiagRow } from "./index";

export const probe = {
  hostNowMs: (): number | null => native?.hostNowMs() ?? null,
  footprintMb: (): number | null => native?.footprintMb() ?? null,
  outputLatencyMs: (): number | null => native?.outputLatencyMs?.() ?? null,
  ioBufferMs: (): number | null => native?.ioBufferMs?.() ?? null,
  inputLatencyMs: (): number | null => native?.inputLatencyMs?.() ?? null,
  canCapture: (): boolean => typeof native?.startCapture === "function",
  startCapture: (mic: boolean): Promise<boolean> => native?.startCapture?.(mic) ?? Promise.resolve(false),
  stopCapture: (): Promise<boolean> => native?.stopCapture?.() ?? Promise.resolve(false),
  startMotion: (): boolean => native?.startMotion?.() ?? false,
  stopMotion: (): void => native?.stopMotion?.(),
  drain(): void {
    const rows = native?.drain?.() ?? [];
    if (!native || rows.length === 0) return;
    const offset = performance.now() - native.hostNowMs();
    for (const { host, ...row } of rows) diag({ ...row, t: Number(host) + offset } as unknown as DiagRow);
  },
};
