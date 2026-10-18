/* ============================================================
   MBA 备考中心 · 站点级账号层（纯前端，静态托管无后端）
   ------------------------------------------------------------
   - 账号表只存 SHA-256("用户名:密码") 摘要，源码里没有明文密码；
   - 会话存 localStorage（mba_auth），关浏览器再开也不用重新登录；
   - 所有持久化数据用 acctKey(base) 拼账号后缀，实现「数据以账号为单位」。
   首页 / login.html 引 auth.js；exam/ 由构建注入 ../auth.js；
   essay.html 为保持单文件，内联了同款守卫逻辑（改动时两处同步）。
   ============================================================ */
(function () {
  const SESSION_KEY = 'mba_auth';

  // 账号表：用户名 -> sha256("用户名:密码") 十六进制摘要。
  // 新增账号：控制台跑 MBAAuth.hash('用户名:密码')，把结果补进来。
  const ACCOUNTS = {
    admin: 'efd5c491a23e69c40a92e89d054ee7abb55deedef7e42b0bfcb2779cd9635a5c',
  };

  const hex = (buf) =>
    [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  async function hash(str) {
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
  }

  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return (s && s.u && ACCOUNTS[s.u]) ? s.u : null;
    } catch { return null; }
  }

  window.MBAAuth = {
    hash,
    ACCOUNTS,
    /** 当前登录用户名；未登录返回 null。 */
    user: readSession,
    /** 页面守卫：未登录 → 跳登录页（带 next 参数，登录后跳回）。 */
    guard(loginURL, nextPath) {
      if (this.user()) return true;
      const sep = loginURL.includes('?') ? '&' : '?';
      location.replace(loginURL + sep + 'next=' + encodeURIComponent(nextPath || ''));
      return false;
    },
    /** 校验账号密码；成功则写入会话。 */
    async login(u, p) {
      u = String(u || '').trim();
      const expect = ACCOUNTS[u];
      if (!expect) return false;
      if ((await hash(u + ':' + String(p))) !== expect) return false;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ u, t: Date.now() }));
      return true;
    },
    logout() { localStorage.removeItem(SESSION_KEY); },
    /** 按账号隔离的存储键：base + ':' + 用户名（无会话回落 local）。 */
    acctKey(base) { return base + ':' + (this.user() || 'local'); },
  };
})();
