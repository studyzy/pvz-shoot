import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  loader,
  loadingManager,
  TrackedGLTFLoader,
  loadSummary,
  onLoadProgress,
  estimateBytes,
  expectReady,
} from '../../src/assets/LoadProgress.js';

// 首页的下载进度面板完全依赖这张进度表；口径错一格，玩家看到的就是"一直 0%".
function reset() {
  // 注意：loadingManager 的 itemStart 是实例自有属性，这里只清数据，不重建 manager
  loader.items.length = 0;
  loader.listeners.clear();
  loader.estimate = 0;
  loader.readyCount = 0;
  loadingManager.byUrl.clear();
  loadingManager.open.clear();
}

describe('LoadProgress 汇总', () => {
  beforeEach(reset);

  it('按文件计数：itemStart 建条目，itemEnd 落定', () => {
    loadingManager.itemStart('/models/zombie.glb');
    loadingManager.itemEnd('/models/zombie.glb');
    loadingManager.itemStart('/models/alchemist.glb');
    expect(loadSummary()).toMatchObject({ count: 2, done: 1, finished: false });
    loadingManager.itemEnd('/models/alchemist.glb');
    expect(loadSummary()).toMatchObject({ count: 2, done: 2, finished: true });
  });

  it('GLTFLoader 对同一 url 报两次 itemStart：只在最后一个结束时落定', () => {
    loadingManager.itemStart('/models/x.glb'); // 文件本身
    loadingManager.itemStart('/models/x.glb'); // 解析完成再记一次
    loadingManager.itemEnd('/models/x.glb');
    expect(loadSummary()).toMatchObject({ count: 1, done: 0 });
    loadingManager.itemEnd('/models/x.glb');
    expect(loadSummary()).toMatchObject({ count: 1, done: 1 });
  });

  it('blob:/data: 不算下载（glb 内嵌贴图会走同一个 manager）', () => {
    loadingManager.itemStart('blob:http://localhost/abc');
    loadingManager.itemStart('data:image/png;base64,AAAA');
    expect(loader.items).toHaveLength(0);
    expect(loadSummary().count).toBe(0);
  });

  it('失败也算落定，并计入 failed', () => {
    loadingManager.itemStart('/models/a.glb');
    loadingManager.itemError('/models/a.glb');
    const s = loadSummary();
    expect(s.done).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.finished).toBe(true);
  });

  it('字节数来自 progress 的 Content-Length；percent 按字节算', () => {
    const url = '/models/big.glb';
    loadingManager.itemStart(url);
    loadingManager.trackProgress(url, { lengthComputable: true, loaded: 250, total: 1000 });
    expect(loadSummary()).toMatchObject({ loaded: 250, total: 1000, percent: 25 });
    // 不可计算的进度事件不覆盖
    loadingManager.trackProgress(url, { lengthComputable: false, loaded: 999, total: 0 });
    expect(loadSummary().loaded).toBe(250);
    loadingManager.itemEnd(url);
    // 结束时以真实字节数为准
    expect(loadSummary()).toMatchObject({ done: 1, loaded: 1000, percent: 100 });
  });

  it('还没有任何响应时用粗估兜底，进度条不会卡在 0 分母', () => {
    estimateBytes(2000);
    expect(loadSummary()).toMatchObject({ total: 2000, percent: 0 });
    loadingManager.itemStart('/models/a.glb');
    loadingManager.trackProgress('/models/a.glb', { lengthComputable: true, loaded: 1000, total: 2000 });
    expect(loadSummary().percent).toBe(50);
  });

  it('就绪口径：首屏文件全部落定才算 ready；没有受跟踪请求时不算', () => {
    expect(loadSummary().ready).toBe(false);
    loadingManager.itemStart('/models/a.glb');
    loadingManager.itemStart('/models/b.glb');
    expectReady(2);
    loadingManager.itemEnd('/models/a.glb');
    expect(loadSummary().ready).toBe(false);
    loadingManager.itemEnd('/models/b.glb');
    expect(loadSummary().ready).toBe(true);
    expect(loadSummary().finished).toBe(true);
  });

  it('订阅者每次变化都被通知，取消订阅后不再收到', () => {
    let calls = 0;
    const off = onLoadProgress(() => calls++);
    loadingManager.itemStart('/models/a.glb');
    expect(calls).toBe(1);
    off();
    loadingManager.itemEnd('/models/a.glb');
    expect(calls).toBe(1);
  });

  it('早退分支：非正数估算、重复落定、未开始就结束/报错都不改状态', () => {
    estimateBytes(0);
    estimateBytes(-5);
    expect(loader.estimate).toBe(0);

    loadingManager.itemStart('/models/a.glb');
    loadingManager.itemEnd('/models/a.glb');
    // 落定后同一个 url 再报结束/失败：不重复计数，也不会把 failed 打上
    loadingManager.itemEnd('/models/a.glb');
    expect(loadSummary()).toMatchObject({ done: 1, failed: 0 });

    // 从未 itemStart 过的 url 直接结束/报错：静默忽略，不进表
    loadingManager.itemEnd('/models/ghost.glb');
    loadingManager.itemError('/models/ghost.glb');
    expect(loadSummary()).toMatchObject({ count: 1, done: 1 });
  });

  it('加载器统一接入这张进度表（构造时拿到的就是它）', () => {
    const l = new TrackedGLTFLoader();
    expect(l.manager).toBe(loadingManager);
    expect(l instanceof THREE.Loader).toBe(true);
  });
});