import { Game } from './Game.js';

const canvas = document.getElementById('game');

function fail(message) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font:600 15px/1.7 -apple-system,PingFang SC,sans-serif;color:#fff;background:#1d2b12;z-index:99';
  box.textContent = message;
  document.body.appendChild(box);
}

try {
  const game = new Game(canvas);
  window.__game = game;
  requestAnimationFrame(game.loop);
} catch (err) {
  console.error(err);
  fail('启动失败：' + (err && err.message ? err.message : '浏览器不支持 WebGL'));
}
