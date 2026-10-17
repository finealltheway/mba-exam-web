/* ============================================================
 * secure.js — 发布版数据解密运行时
 * 本文件由 build_secure.mjs 自动生成（密钥段每次构建随机），请勿手改。
 *
 * 职责：把 data/payload.enc.js 里的 AES-256-GCM 密文解密，
 * 写回 window.BANK_DATA / window.WORD_DICT_DATA / window.ASSETS。
 * 下游 engine.js（getBank / assetURL）与 app.js（查词）原样读取
 * 这些全局变量 —— 业务逻辑零改动。
 *
 * 能力边界（诚实声明）：密钥终归在客户端，本方案的意义是把
 * 「右键另存就能扒走」提高到「需要逆向 JS」。绝对防护需要服务端
 * 按需下发，与「离线双击即用」互斥，见 安全架构分析与加固方案.md。
 * ============================================================ */
(function () {
  'use strict';

  /* ---- 密钥段（构建时注入）----
     32 字节密钥切成 5 段，每段先做「字节循环移位」再 base64，
     段序打乱存放（段内自带原始序号）。运行时逆变换、按序号排序、
     拼接还原。目的是让 grep 一个完整密钥变得不可能。 */
  var _KS = [
    [3, "kHf+if4tZg=="],
    [1, "1K01pr/m"],
    [0, "N3Nx9O76"],
    [4, "/khOF+7edA=="],
    [2, "cpvgyRYa"],
  ];

  // 每段的循环移位量，与段的原始序号绑定
  var _SHIFT = [3, 11, 7, 19, 5];

  function _b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function _rebuildKey() {
    var segs = _KS.slice().sort(function (a, b) { return a[0] - b[0]; });
    var parts = segs.map(function (s, i) {
      var bytes = _b64ToBytes(s[1]);
      // 逆向「字节循环移位」（构建时做的是 +shift）
      return Array.prototype.map.call(bytes, function (b) {
        return (b - _SHIFT[i] + 256) % 256;
      });
    });
    var flat = [].concat.apply([], parts);
    var key = new Uint8Array(32);
    for (var i = 0; i < 32; i++) key[i] = flat[i];
    return key;
  }

  /* 密文布局：IV(12 字节) || AES-GCM(密文 + 16 字节 tag) */
  function _decrypt(b64) {
    var raw = _b64ToBytes(b64);
    var iv = raw.slice(0, 12), ct = raw.slice(12);
    return crypto.subtle.importKey('raw', _rebuildKey(), 'AES-GCM', false, ['decrypt'])
      .then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
      })
      .then(function (pt) { return new TextDecoder().decode(pt); });
  }

  /**
   * 解密三份数据并写回原全局变量。
   * 开发态没有 payload.enc.js（BANK_ENC 等未定义）→ 直接跳过，
   * 页面走原来的明文 fetch / assets.js 路径，行为与改造前完全一致。
   * @returns {Promise<number>} 实际解密的数据份数（0 = 开发态）
   */
  window.unpackSecure = function () {
    var jobs = [];
    if (typeof BANK_ENC === 'string' && BANK_ENC) {
      jobs.push(_decrypt(BANK_ENC).then(function (json) {
        window.BANK_DATA = JSON.parse(json);
      }));
    }
    if (typeof DICT_ENC === 'string' && DICT_ENC) {
      jobs.push(_decrypt(DICT_ENC).then(function (json) {
        window.WORD_DICT_DATA = JSON.parse(json);
      }));
    }
    if (typeof ASSETS_ENC === 'string' && ASSETS_ENC) {
      jobs.push(_decrypt(ASSETS_ENC).then(function (json) {
        window.ASSETS = JSON.parse(json);
      }));
    }
    if (!jobs.length) return Promise.resolve(0);
    var t0 = (window.performance || Date).now();
    return Promise.all(jobs).then(function () {
      window.__UNPACK_MS__ = Math.round((window.performance || Date).now() - t0);
      return jobs.length;
    });
  };

  /* 老浏览器无 WebCrypto 时给出明确提示。
     现代浏览器（含 file:// 双击打开——W3C 将 file: 列为
     potentially trustworthy origin）均支持 crypto.subtle。 */
  if (!(window.crypto && window.crypto.subtle)) {
    var hasEnc = typeof BANK_ENC === 'string' || typeof ASSETS_ENC === 'string';
    if (hasEnc) {
      console.warn('[secure] 当前浏览器不支持 WebCrypto，无法解密数据，请升级浏览器。');
    }
  }
})();
