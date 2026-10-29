// jsdom 没有 URL.createObjectURL / fetch(blob:)，而 GLTFLoader 解析 glb 内嵌贴图的路径是
// createObjectURL -> ImageBitmapLoader.fetch -> createImageBitmap。这里补一条最小的等价链路。
let seq = 0;
const store = new Map();

export function installBlobUrls() {
  if (window.URL.createObjectURL) return;
  const create = (blob) => {
    const url = 'blob:http://localhost:3000/' + (seq += 1);
    store.set(url, blob);
    return url;
  };
  const revoke = (url) => store.delete(url);
  window.URL.createObjectURL = create;
  globalThis.URL.createObjectURL = create;
  window.URL.revokeObjectURL = revoke;
  globalThis.URL.revokeObjectURL = revoke;

  globalThis.__blobForUrl = (url) => store.get(url);
}
