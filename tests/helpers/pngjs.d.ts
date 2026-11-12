declare module "pngjs" {
  export const PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } };
}
