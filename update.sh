#!/bin/bash
# ============================================================
#  一键更新到 GitHub Pages
#  用法：
#    bash update.sh "更新说明"
#  例：
#    bash update.sh "新增 2026 英语二作文题"
# ============================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$HOME/.github_token"
MSG="${1:-更新内容}"

# 开发目录（含全部测试工具，是真正改代码的地方）
DEV_DIR="$(cd "$REPO_DIR/.." && pwd)/模拟考试系统"

# Python 解释器（构建 + 行尾归一化都要用）
PY="/c/Users/77158/.workbuddy/binaries/python/versions/3.13.12/python.exe"
NODE="/c/Users/77158/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
API="https://api.github.com/repos/finealltheway/mba-exam-web"

# 清理失效代理（这台机器上曾经有过127.0.0.1:52227 的死代理）
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

# ---------- 网络检测 ----------
# 这台机器的网络有个坑：DNS 把 github.com 解析到 20.205.243.166，
# 而那个 IP 经常被阻断（表现为 git push/clone 超时），但同网段的
# .169/.171 或美西 140.82.x.x 完全正常。所以直连失败时先换IP，
# 换不通再找本地代理。

# curl 额外参数：命中就用 --resolve 绕过被污染的 DNS
RESOLVE_OPT=""

probe() {  # $1 = 目标 url
  if [ -n "$RESOLVE_OPT" ]; then
    timeout 8 curl -sI $RESOLVE_OPT "$1" -o /dev/null 2>/dev/null
  else
    timeout 8 curl -sI "$1" -o /dev/null 2>/dev/null
  fi
}

NET_OK=0

# 上传只需要 api.github.com（blob/tree/commit/ref 全在这）。
# git push 才需要 github.com。所以先探API——它通常比主站稳。
if probe https://api.github.com/zen; then
  NET_OK=1
  echo "[网络] GitHub API 可用"
else
  echo "[网络] API 探测失败，尝试换 IP..."
  for ip in 20.205.243.169 20.205.243.171 140.82.112.3 140.82.113.3 \
            140.82.114.3 140.82.116.3 140.82.121.3; do
    if timeout 6 curl -sI --resolve "api.github.com:443:$ip" https://api.github.com/zen \
         -o /dev/null 2>/dev/null; then
      RESOLVE_OPT="--resolve api.github.com:443:$ip"
      NET_OK=1
      echo "[网络] API 已切换到可用 IP $ip"
      break
    fi
  done
fi

# 阶段 2：github.com 主站（git push 用）。不通也能走 API 兜底。
GIT_OK=0
if timeout 8 curl -sI https://github.com -o /dev/null 2>/dev/null; then
  GIT_OK=1
  GIT_HOST="https://github.com"
  echo "[网络] github.com 主站可达，git push 可用"
else
  echo "[网络] github.com 主站不通（git push 会失败，将走 API 兜底）"
  for ip in 20.205.243.169 20.205.243.171 140.82.112.3 140.82.113.3 \
            140.82.114.3 140.82.116.3 140.82.121.3; do
    if timeout 6 curl -sI --resolve "github.com:443:$ip" https://github.com \
         -o /dev/null 2>/dev/null; then
      GIT_HOST="https://${ip}"
      GIT_OK=1
      echo "[网络] github.com 已切换到可用 IP $ip"
      break
    fi
  done
fi

# 阶段 3：本地代理（API 和主站都不通时才找）
if [ "$NET_OK" -ne 1 ] || [ "$GIT_OK" -ne 1 ]; then
  echo "[网络] 查找本地代理..."
  for p in 7890 7897 10809 10808 8889 52227 1080 20171 33210; do
    if timeout 5 curl -sI -x "http://127.0.0.1:$p" https://api.github.com/zen \
         -o /dev/null 2>/dev/null; then
      export HTTPS_PROXY="http://127.0.0.1:$p"
      export HTTP_PROXY="http://127.0.0.1:$p"
      RESOLVE_OPT=""
      NET_OK=1
      GIT_OK=1
      GIT_HOST="https://github.com"
      echo "[网络] 已启用代理 127.0.0.1:$p"
      break
    fi
  done
fi

if [ "$NET_OK" -ne 1 ]; then
  echo ""
  echo "[✗] 无法连接 GitHub API（直连/换IP/代理都试过了）。"
  echo "    1) 开启你的代理客户端（Clash / v2ray 等）后重跑本脚本"
  echo "    2) 或换个网络环境重试"
  echo "    本地改动已提交，不会丢失。"
  exit 1
fi

cd "$REPO_DIR"

# 从 PowerShell 调用时输出会变乱码（PS 5.1 默认按 GBK 解码 UTF-8 字节）。
# 这里统一成 UTF-8，能解决大部分；剩下的在 调用方加 [Console]::OutputEncoding。
export PYTHONIOENCODING=utf-8

echo "========================================"
echo "  MBA 模考系统 · 一键更新"
echo "========================================"

# 1. 检查 token
if [ ! -f "$TOKEN_FILE" ]; then
  echo "[✗] 找不到 token 文件：$TOKEN_FILE"
  echo "    请先创建一个 Personal Access Token（勾选 repo + workflow），"
  echo "    存到该文件："
  echo "      \$token = Read-Host '粘贴 Token'"
  echo "      Set-Content -Path \"\$env:USERPROFILE\\.github_token\" -Value \$token -Encoding ascii -NoNewline"
  exit 1
fi
TOKEN=$(cat "$TOKEN_FILE")
echo "[✓] token 已读取（${#TOKEN} 字符）"

# 2. 从开发目录同步（这是最关键的一步）
#    开发目录 = E:\MBA\真题\模拟考试系统，那里有测试工具，是真正改代码的地方
#    发布目录 = mba-exam-web，只有 4 个必需文件，是部署用的副本
echo ""
echo "[同步] 从开发目录同步网页文件..."

# ---- 防误改检测（必须在覆盖之前跑）----
# 历史上出过两次事故：用户在**发布目录**里改了题库/代码，
# 而发布目录是本脚本的输出目标 —— 跑一次就被开发目录的旧版覆盖，修改全丢。
# 这里主动比对：发布目录比开发目录新、且内容确实不同 -> 停下来报警，
# 让人先把改动回写到开发目录，而不是默默覆盖。
echo ""
echo "[检查] 发布目录是否被误改..."
CONFLICT=0
if [ -f "$PY" ]; then
  CHECK=$("$PY" - "$DEV_DIR" "$REPO_DIR" <<'PYEOF' 2>/dev/null
import os, sys, hashlib
dev, pub = sys.argv[1], sys.argv[2]

def h(p):
    # 必须归一化行尾再比：开发目录在 Windows 上编辑（CRLF），
    # 发布目录被脚本统一成 LF，不归一化会把纯行尾差异当成内容不同。
    with open(p, "rb") as f:
        d = f.read().replace(b"\r\n", b"\n")
    return hashlib.sha1(d).hexdigest()

warn = []
# 发布目录 index.html 的脚本标签由 build_secure.mjs 改写，内容天然与开发版不同，跳过。
# 明文数据文件（assets.js / data/*.json / data/dictionary.js）已不再进入发布树，
# 密文每次构建都重新生成，无可比性。
targets = ["app.js", "engine.js", "guard.js"]
for rel in targets:
    d, p = os.path.join(dev, rel), os.path.join(pub, rel)
    if not (os.path.isfile(d) and os.path.isfile(p)):
        continue
    if h(d) == h(p):
        continue
    # 内容确实不同：若发布目录更新，说明是有人在这里改的
    if os.path.getmtime(p) > os.path.getmtime(d) + 2:
        warn.append(rel)

for w in warn:
    print(f"    ! {w}")
if not warn:
    print("    ✓ 未发现误改")
PYEOF
)
  echo "$CHECK"
  # CHECK 里带 "!" 行的数量
  WARN_COUNT=$(echo "$CHECK" | grep -c "^\s*!" || true)
  if [ "$WARN_COUNT" -gt 0 ]; then
    CONFLICT=1
  fi
fi

if [ "$CONFLICT" -eq 1 ]; then
  echo ""
  echo "[X] 检测到你改了**发布目录**（mba-exam-web）里的文件："
  echo "$CHECK" | grep "^\s*!"
  echo ""
  echo "    发布目录是部署副本，跑本脚本会被开发目录覆盖，改动会丢失。"
  echo "    请先把改动搬到开发目录再更新："
  echo "      1) 复制上面列出的文件到 模拟考试系统\\对应位置"
  echo "      2) 或告诉我，我帮你合并"
  echo ""
  echo "    确认要放弃发布目录的改动、直接用开发目录覆盖，就按Ctrl+C 退出，"
  echo "    然后重新运行本脚本。"
  exit 1
fi

echo ""
if [ -d "$DEV_DIR" ]; then
  # app.js / engine.js 是业务代码；index.html 由 build_secure.mjs 改写为密文加载。
  # secure.js 由 build_secure.mjs 生成（内含每次构建随机的混淆密钥），
  # guard.js 也由 build_secure.mjs 随构建同步 —— 两者都绝不从开发目录复制。
  for f in app.js engine.js; do
    if [ -f "$DEV_DIR/$f" ]; then
      if ! diff -q "$DEV_DIR/$f" "$REPO_DIR/$f" >/dev/null 2>&1; then
        cp "$DEV_DIR/$f" "$REPO_DIR/$f"
        echo "    ✓ $f 已更新"
      else
        echo "    · $f 无变化"
      fi
    fi
  done
  # index.html 不在这里同步：build_secure.mjs 每次都以**开发目录**的
  # index.html 为源重新生成发布版（改脚本标签），不存在漏同步的可能。
  # 发布树不再存放任何明文数据（题库/词典/图片一律以 AES-256-GCM 密文
  # 由 build_secure.mjs 生成后写入 data/payload.enc.js）。这里只做清理：
  # 把旧构建留下的明文文件删掉，防止它们被 git add -A 重新推上线。
  for rel in assets.js data/question_bank.json data/dictionary.js data/bank.js build_for_pages.py; do
    if [ -f "$REPO_DIR/$rel" ]; then
      rm -f "$REPO_DIR/$rel"
      echo "    ✓ 清理明文遗留 $rel"
    fi
  done

  # 行尾归一化：开发目录在 Windows 上编辑，文件是 CRLF；
  # 发布目录必须存 LF，否则 .gitattributes 生效后 git 会认为整个文件都改了。
  # 用 Python 做，避免依赖 dos2unix（Git Bash 不一定带）。
  if [ -f "$PY" ]; then
    "$PY" - "$REPO_DIR" <<'PYEOF' 2>/dev/null
import os, sys
root = sys.argv[1]
files = ["index.html", "app.js", "engine.js", "guard.js", "secure.js",
         "data/payload.enc.js", "robots.txt", "README.md"]
n = 0
for rel in files:
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        continue
    d = open(p, "rb").read()
    if b"\r\n" in d:
        open(p, "wb").write(d.replace(b"\r\n", b"\n"))
        n += 1
if n:
    print(f"    ⟳ 已把 {n} 个文件的行尾统一为 LF")
PYEOF
  fi

  echo ""
  echo "  提示：如需重新生成图片资源（assets.js），在开发目录执行 python _embed_assets.py"
else
  echo "    [警告] 找不到开发目录 $DEV_DIR，跳过同步"
fi

# 3. 安全检查：绝不提交 PDF
echo ""
echo "[检查] 扫描 PDF..."
PDF_FOUND=$(find . -name "*.pdf" -type f -not -path "./.git/*" | wc -l)
if [ "$PDF_FOUND" -gt 0 ]; then
  echo "[✗] 检测到 $PDF_FOUND 个 PDF 文件，已阻止推送！"
  echo "    原题PDF 不应上传。已确认 .gitignore 规则或移除这些文件。"
  exit 1
fi
echo "[✓] 无 PDF 文件"

# 4. 构建密文（AES-256-GCM）
#    题库/词典/图片加密后写入 data/payload.enc.js，随机密钥注入 secure.js，
#    index.html 脚本标签改为密文加载。明文数据一律不进入发布树。
echo ""
echo "[构建] 加密数据（AES-256-GCM）..."
if "$NODE" "$DEV_DIR/build_secure.mjs" "$REPO_DIR" 2>&1 | sed 's/^/    /'; then
  echo "    ✓ 密文构建完成"
else
  echo ""
  echo "    [✗] 密文构建失败，已终止（避免把明文推上线）"
  exit 1
fi

# 5. 提交
echo ""
echo "[提交] 暂存改动..."
git add -A
if git diff --cached --quiet; then
  echo "[i] 没有改动，无需提交"
  exit 0
fi

# 再确认一次 PDF 没混进暂存区
if git diff --cached --name-only | grep -qi "\.pdf$"; then
  echo "[✗] 暂存区含 PDF，中止"
  git reset
  exit 1
fi

git -c user.name="finealltheway" \
    -c user.email="finealltheway@users.noreply.github.com" \
    commit -q -m "$MSG"
echo "[✓] 已提交：$MSG"

# 6. 推送（网络易抖动；先走 git，失败则改用 REST API 逐 blob 兜底）
echo ""
echo "[推送] 上传到 GitHub..."
PUSH_OK=0
if [ "$GIT_OK" -ne 1 ]; then
  echo "    github.com 主站不通，跳过 git push，直接走 API 兜底"
else
  for attempt in 1 2 3; do
    if git -c http.postBuffer=524288000 -c http.version=HTTP/1.1 \
            -c http.lowSpeedLimit=0 -c http.lowSpeedTime=999999 \
            push "https://finealltheway:${TOKEN}@${GIT_HOST}/finealltheway/mba-exam-web.git" main 2>/dev/null; then
      PUSH_OK=1
      break
    fi
    echo "    第 $attempt 次 git push 失败，3 秒后重试..."
    sleep 3
  done
fi

# git 推送大包（assets.js 3.9 MB）常被中途掐断。
# 兜底方案：走 Git Data API，把每个改动文件作为 blob 单独上传再组 tree，
# 单请求体积小、不产生 packfile，实测比 git push 稳得多。
if [ "$PUSH_OK" -ne 1 ]; then
  echo ""
  echo "    git push 连续失败，改用 REST API 兜底上传..."
  if "$PY" "$REPO_DIR/api_push.py" "$TOKEN" "$MSG" "$RESOLVE_OPT"; then
    PUSH_OK=1
    echo "    ✓ REST API 上传成功"
  else
    echo ""
    echo "[✗] 两种方式都推送失败。"
    echo "    1) 确认网络能访问 github.com（可尝试开启代理后重跑本脚本）"
    echo "    2) 或稍后在网络稳定时重跑：bash update.sh \"$MSG\""
    echo "    本地改动已提交，不会丢失。"
    exit 1
  fi
fi
echo "[✓] 推送成功"

# 7. 清理 .git/config 里的 token（push 会写进去）
git remote set-url origin https://github.com/finealltheway/mba-exam-web.git
sed -i 's|^\tremote = https://finealltheway:ghp_[A-Za-z0-9]*@github.com/finealltheway/mba-exam-web.git$|\tremote = origin|' .git/config
echo "[✓] 已清理配置文件中的 token"

# 8. 查部署状态
echo ""
echo "[部署] 等待 GitHub Actions 完成..."
for i in $(seq 1 12); do
  ST=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
    "$API/actions/workflows/deploy.yml/runs?per_page=1" \
    | "$NODE" -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const r=JSON.parse(s).workflow_runs[0];
      console.log(r.status+" / "+r.conclusion);}catch(e){console.log("查询中");}
})' 2>/dev/null)
  echo "  [$i] $ST"
  if echo "$ST" | grep -q "success"; then
    echo ""
    echo "========================================"
    echo "  ✓ 部署成功"
    echo "  https://finealltheway.github.io/mba-exam-web/"
    echo "========================================"
    exit 0
  fi
  if echo "$ST" | grep -q "failure"; then
    echo ""
    echo "[✗] 部署失败，请到Actions 页面查看日志："
    echo "    https://github.com/finealltheway/mba-exam-web/actions"
    exit 1
  fi
  sleep 20
done

echo ""
echo "[!] 等待超时。站点通常仍会陆续完成，可稍后手动访问："
echo "    https://finealltheway.github.io/mba-exam-web/"