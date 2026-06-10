import { PhotonImage } from '@cf-wasm/photon';
import fs from 'fs';

export async function bufferToJpeg(buffer: Buffer, outputPath: string, quality: number = 85): Promise<{ w: number; h: number }> {
  const image = PhotonImage.new_from_byteslice(new Uint8Array(buffer));
  const w = image.get_width();
  const h = image.get_height();
  const jpegBytes = image.get_bytes_jpeg(quality || 85);
  image.free();
  fs.writeFileSync(outputPath, Buffer.from(jpegBytes));
  return { w, h };
}
