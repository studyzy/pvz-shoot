// 能通过 postfx / ssao「能力探测」的假渲染器。
//
// 两个模块的探测条件是：有 getContext + setRenderTarget，且上下文能 createTexture。
// 真正的 GL 调用只发生在 renderer.render / setRenderTarget 里，所以用一个记录调用的
// 替身就能把管线装配、档位分支、失败兜底整条跑通，不需要真实 WebGL。
//
// 不能放 tests/helpers/game.js：那个文件被 vi.mock('three') 的工厂动态引用，
// 这里保持零依赖，谁都能直接 import（规则 B 见 docs/TESTING.md）。
//
// @param {object} [opts]
// @param {boolean} [opts.webgl2]  false 时模拟 WebGL1（没有深度纹理 / MSAA）
// @param {(n:number) => void} [opts.onRender] 每次 render 调用后触发，可用来模拟 GL 抛错
export function makeGLRenderer(opts = {}) {
  const calls = { render: [], setRenderTarget: [] };
  let target = null;

  const renderer = {
    capabilities: { isWebGL2: opts.webgl2 !== false },
    toneMapping: 0,
    toneMappingExposure: 1,
    getContext: () => ({ createTexture: () => ({}) }),
    getRenderTarget: () => target,
    setRenderTarget(t) {
      target = t;
      calls.setRenderTarget.push(t);
    },
    clear() {},
    render(scene, camera) {
      calls.render.push({ scene, camera, toneMapping: renderer.toneMapping, target });
      if (opts.onRender) opts.onRender(calls.render.length);
    },
  };

  return { renderer, calls };
}