/* ============================================================
 * guard.js — 前端防拷贝加固（威慑层，非安全边界）
 *
 * 定位：把「顺手牵羊」的成本抬高，与 secure.js 的密文存储配合。
 * 诚实声明：以下措施均可被专业手段绕过，不构成绝对防护；
 * 它们的存在是为了让普通访客不能零成本保存/打印/拖走内容。
 *
 * 刻意不做的事：
 *   - 不用无限 debugger（会搞崩正常用户的浏览器，得不偿失）；
 *   - 不禁用文字选择（双击查词依赖 selection）；
 *   - 不拦输入框/编辑区的右键（要保留粘贴）。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 1. 右键菜单：考试内容区拦截 ---------- */
  document.addEventListener('contextmenu', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
  });

  /* ---------- 2. 保存 / 看源码 / 打印 ---------- */
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var k = (e.key || '').toLowerCase();
    if (k === 's' || k === 'u' || k === 'p') {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  /* ---------- 3. 题面图片禁止拖出到桌面 ---------- */
  document.addEventListener('dragstart', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG') e.preventDefault();
  });

  /* ---------- 4. DevTools 打开检测（启发式）----------
     开发者工具停靠在右侧/底部时，视口与窗口尺寸差会显著变大。
     命中则显示警示条。纯启发式，漏判不影响任何功能。 */
  var tip = null, tipTimer = null;
  function showTip() {
    if (tip) return;
    tip = document.createElement('div');
    tip.id = 'guard-tip';
    tip.textContent = '本页面内容受保护，请勿转载、镜像或用于商业用途';
    tip.setAttribute('style',
      'position:fixed;right:14px;bottom:14px;z-index:9999;' +
      'background:rgba(28,43,58,.88);color:#fff;font-size:12px;' +
      'padding:7px 13px;border-radius:8px;pointer-events:none;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.18);letter-spacing:.2px;');
    document.body.appendChild(tip);
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 6000);
  }
  function hideTip() {
    if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
    tip = null;
  }
  function checkDevtools() {
    try {
      var dw = (window.outerWidth || 0) - (window.innerWidth || 0);
      var dh = (window.outerHeight || 0) - (window.innerHeight || 0);
      // 停靠左右约 200-800px、上下约 200-400px；留 160px 阈值避开滚动条/圆角
      if (dw > 160 || dh > 160) showTip();
    } catch (e) { /* 某些环境取不到尺寸，静默跳过 */ }
  }
  window.addEventListener('resize', checkDevtools);
  window.addEventListener('load', checkDevtools);
})();
