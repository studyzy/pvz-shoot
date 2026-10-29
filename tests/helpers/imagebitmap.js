// jsdom 没有 createImageBitmap，而 GLTFLoader 解析 glb 内嵌 WebP 时必须用它来解贴图。
// 用 @napi-rs/canvas 解码，再包成 ImageBitmap 需要的最小接口（width/height/close）。
import { createCanvas, loadImage } from '@napi-rs/canvas';

export function installImageBitmap() {
  if (globalThis.createImageBitmap) return globalThis.createImageBitmap;
  const impl = async (source) => {
    let bytes = null;
    if (source instanceof Blob) bytes = new Uint8Array(await source.arrayBuffer());
    else if (source && source.__bytes) bytes = source.__bytes;
    else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
    if (!bytes) throw new Error('unsupported ImageBitmap source');
    const img = await loadImage(Buffer.from(bytes));
    const canvas = createCanvas(img.width, img.height);
    canvas.getContext('2d').drawImage(img, 0, 0);
    return {
      width: img.width,
      height: img.height,
      close() {},
      __canvas: canvas,
    };
  };
  globalThis.createImageBitmap = impl;
  window.createImageBitmap = impl;
  return impl;
}
