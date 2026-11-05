declare module "heic-convert" {
  type HeicConvertOptions = {
    buffer: Buffer | ArrayBuffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  function convert(options: HeicConvertOptions): Promise<Buffer>;
  export default convert;
}
