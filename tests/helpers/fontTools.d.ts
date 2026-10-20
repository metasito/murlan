declare module "fontverter" {
  type Format = "sfnt" | "woff" | "woff2";
  const fontverter: { convert(buffer: Buffer, toFormat: Format, fromFormat?: Format): Promise<Buffer> };
  export default fontverter;
}

declare module "subset-font" {
  export default function subsetFont(font: Buffer, text: string, options?: { targetFormat?: "sfnt" | "woff" | "woff2" | "truetype" }): Promise<Buffer>;
}
