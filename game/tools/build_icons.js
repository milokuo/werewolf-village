/* 把 client/assets/icons/*.svg 打包成 client/js/icons.js
   - 移除黑色背景矩形
   - fill 改為 currentColor（可用 CSS 上色）
   用法：node tools/build_icons.js */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'client', 'assets', 'icons');
const OUT = path.join(__dirname, '..', 'client', 'js', 'icons.js');

const icons = {};
for (const f of fs.readdirSync(SRC).filter((x) => x.endsWith('.svg'))) {
  const key = f.replace(/\.svg$/, '');
  let s = fs.readFileSync(path.join(SRC, f), 'utf8');
  const inner = s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  let cleaned = inner
    .replace(/<path d="M0 0h512v512H0z"\s*\/>/g, '')
    .replace(/<path d="M0 0h512v512H0z"><\/path>/g, '')
    .replace(/fill="#fff"/g, 'fill="currentColor"')
    .replace(/fill="#ffffff"/gi, 'fill="currentColor"');
  if (!cleaned.includes('fill=')) cleaned = cleaned.replace(/<path /g, '<path fill="currentColor" ');
  icons[key] = cleaned.trim();
}
const js = '/* 自動產生：node tools/build_icons.js\n' +
  '   圖標來源：game-icons.net（CC BY 3.0；作者 Lorc、Delapouite、sbed）*/\n' +
  'window.WV_ICONS = ' + JSON.stringify(icons) + ';\n' +
  'window.icon = function (name, cls) {\n' +
  "  const body = window.WV_ICONS[name] || '';\n" +
  "  return '<svg class=\"icon ' + (cls || '') + '\" viewBox=\"0 0 512 512\" aria-hidden=\"true\">' + body + '</svg>';\n" +
  '};\n';
fs.writeFileSync(OUT, js);
console.log('icons.js 產生完成：' + Object.keys(icons).length + ' 個圖標，' + (js.length / 1024).toFixed(0) + ' KB');
