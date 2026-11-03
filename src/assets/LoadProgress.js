import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// 资源下载进度：首页开场要拉 20+ 个 glb（合计十几 MB），不告诉玩家"在下载什么"，
// 就是一段没有任何反馈的黑屏。这里汇总**每一条**请求的进度，给加载面板用。
//
// 单独成模块的原因：僵尸模型（ZombieModel）、植物包（WeaponModels）、队友模型
// （RemotePlayer）三个加载器都要报进度，放进任何一个都会绕出循环依赖。
//
// 钩子：three 的每个 glb 都走 FileLoader→LoadingManager（itemStart / itemEnd），
// 所以这里把 LoadingManager 包成子类做唯一入口；进度事件由各加载器自己接到
// 对应条目上（GLTFLoader 会把 xhr 的 ProgressEvent 透传给 load 的 onProgress）。
//
// 口径：
//   - count / done 按**文件**计，失败也算落定（不然进度条永远差最后一格）；
//   - 字节数优先用 Content-Length（GLTFLoader 透传的 lengthComputable），
//     没有就退回 load 结束时拿到的真实字节数。
export const loader = {
  // 每条请求：{ url, loaded, total, done, failed }
  items: [],
  listeners: new Set(),
  // 各模块 import 时登记的粗估字节数：收到第一个响应头之前也有东西可显示
  estimate: 0,
  // 首页首屏所需的文件数（由 ZombieModel 声明）：用来判断"能不能开始玩了"
  readyCount: 0,
};

function emit() {
  for (const fn of loader.listeners) fn(loader);
}

export function onLoadProgress(fn) {
  loader.listeners.add(fn);
  return () => loader.listeners.delete(fn);
}

// 由各加载器 import 时登记一个粗估字节数（真实大小以 Content-Length 为准）。
export function estimateBytes(n) {
  if (!(n > 0)) return;
  loader.estimate += n;
  emit();
}

// 首屏必需文件数的声明（ZombieModel 在 init 时按实际排队的槽算出来）。
export function expectReady(count) {
  loader.readyCount = count;
  emit();
}

// LoadingManager 把 itemStart / itemEnd / itemError 写成**实例自有属性**（构造函数里赋值），
// 所以子类覆盖原型方法不会生效。做法反过来：先 super() 拿到原生实现，再在实例上换成带钩子的版本。
export class TrackedLoadingManager extends THREE.LoadingManager {
  constructor() {
    super();
    this.byUrl = new Map();
    const baseStart = this.itemStart;
    const baseEnd = this.itemEnd;
    const baseError = this.itemError;
    // GLTFLoader 会为同一个 url 调两次 itemStart（文件本身一次、"解析完成"再记一次），
    // 所以每个 url 记一个打开中的计数：全部落定才算这个文件结束。
    const open = (this.open = new Map());
    this.itemStart = (url) => {
      baseStart.call(this, url);
      const key = this.resolveURL(url);
      // glb 内嵌贴图会生成 blob: URL 走同一个 manager，那不是"下载"，不该进进度表
      if (key.indexOf('blob:') === 0 || key.indexOf('data:') === 0) return;
      const n = (open.get(key) || 0) + 1;
      open.set(key, n);
      if (n > 1) return;
      const item = { url: key, loaded: 0, total: 0, done: false, failed: false };
      this.byUrl.set(key, item);
      loader.items.push(item);
      emit();
    };
    this.itemEnd = (url) => {
      baseEnd.call(this, url);
      const key = this.resolveURL(url);
      const n = (open.get(key) || 1) - 1;
      if (n > 0) {
        open.set(key, n);
        return;
      }
      open.delete(key);
      const item = this.byUrl.get(key);
      if (!item || item.done) return;
      item.done = true;
      item.loaded = item.total || item.loaded;
      emit();
    };
    this.itemError = (url) => {
      baseError.call(this, url);
      const key = this.resolveURL(url);
      open.delete(key);
      const item = this.byUrl.get(key);
      if (!item) return;
      item.failed = true;
      item.done = true;
      emit();
    };
  }

  // 给加载器用：把一次 load 的 onProgress 接到对应条目上
  trackProgress(url, event) {
    const item = this.byUrl.get(this.resolveURL(url));
    if (!item || !event || !event.lengthComputable) return;
    item.total = event.total;
    item.loaded = event.loaded;
    emit();
  }
}

// 三个加载器共用一个 manager：首页的所有 glb 都记在同一张进度表里。
export const loadingManager = new TrackedLoadingManager();

// 走受跟踪 manager 的 GLTFLoader。加载器本身不改 three，只是统一接入进度表。
export class TrackedGLTFLoader extends GLTFLoader {
  constructor(manager = loadingManager) {
    super(manager);
  }
}

// 当前汇总
export function loadSummary() {
  let done = 0;
  let failed = 0;
  let loaded = 0;
  let total = 0;
  for (const it of loader.items) {
    if (it.done) done++;
    if (it.failed) failed++;
    loaded += it.loaded;
    total += it.total;
  }
  // 还没拿到响应头时用粗估兜底，避免进度条从 0 起步后原地不动
  const shownTotal = total || loader.estimate;
  return {
    count: loader.items.length,
    done,
    loaded,
    total: shownTotal,
    failed,
    percent: shownTotal > 0 ? Math.min(100, (loaded / shownTotal) * 100) : 0,
    finished: loader.items.length > 0 && done === loader.items.length,
    // 首屏必需文件是否全部落定（僵尸/植物/队友模型就绪，可以进游戏了）。
    // 没有任何受跟踪的请求时不算就绪：测试用 glb 替身，压根不经过 LoadingManager。
    ready: loader.items.length > 0 && done >= loader.readyCount,
  };
}