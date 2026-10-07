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
NEED_REBUILD=0

# 清理失效代理（这台机器上曾经有过127.0.0.1:52227 的死代理）
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy

# ---------- 网络检测：自动找可用的本地代理 ----------
# 直连可用就用直连；不可用则尝试常见端口，找到能用的自动设置
DIRECT_OK=0
if timeout 8 curl -sI https://github.com -o /dev/null 2>/dev/null; then
  DIRECT_OK=1
  echo "[网络] 直连 GitHub 正常"
else
  echo "[网络] 直连 GitHub 失败，查找本地代理..."
  for p in 7890 7897 10809 10808 8889 52227 1080 20171 33210; do
    if timeout 5 curl -sI -x "http://127.0.0.1:$p" https://github.com -o /dev/null 2>/dev/null; then
      export HTTPS_PROXY="http://127.0.0.1:$p"
      export HTTP_PROXY="http://127.0.0.1:$p"
      echo "[网络] 已启用代理 127.0.0.1:$p"
      DIRECT_OK=1
      break
    fi
  done
  if [ "$DIRECT_OK" -ne 1 ]; then
    echo ""
    echo "[✗] 无法连接 GitHub，且未找到可用代理。"
    echo "    请先开启你的代理客户端（Clash / v2ray 等），然后重新运行本脚本。"
    exit 1
  fi
fi

cd "$REPO_DIR"

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
if [ -d "$DEV_DIR" ]; then
  for f in app.js engine.js assets.js; do
    if [ -f "$DEV_DIR/$f" ]; then
      if ! diff -q "$DEV_DIR/$f" "$REPO_DIR/$f" >/dev/null 2>&1; then
        cp "$DEV_DIR/$f" "$REPO_DIR/$f"
        echo "    ✓ $f 已更新"
      else
        echo "    · $f 无变化"
      fi
    fi
  done
  # index.html 单独处理：开发版没有内联题库，覆盖后必须重新内联
  if [ -f "$DEV_DIR/index.html" ] && ! diff -q "$DEV_DIR/index.html" "$REPO_DIR/index.html" >/dev/null 2>&1; then
    cp "$DEV_DIR/index.html" "$REPO_DIR/index.html"
    NEED_REBUILD=1
    echo "    ✓ index.html 已更新（将重新内联题库）"
  else
    echo "    · index.html 无变化"
  fi
  # 题库源文件
  if [ -f "$DEV_DIR/data/question_bank.json" ] && ! diff -q "$DEV_DIR/data/question_bank.json" "$REPO_DIR/data/question_bank.json" >/dev/null 2>&1; then
    cp "$DEV_DIR/data/question_bank.json" "$REPO_DIR/data/question_bank.json"
    echo "    ✓ question_bank.json 已更新"
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

# 4. 重新内联题库（GitHub Pages 无法 fetch 本地 JSON）
#    若 index.html 刚从开发目录覆盖过来，必须强制重建（--force）
echo ""
echo "[构建] 内联题库到 index.html..."
PY="/c/Users/77158/.workbuddy/binaries/python/versions/3.13.12/python.exe"
if [ -f "$PY" ]; then
  FORCE_FLAG=""
  [ "$NEED_REBUILD" = "1" ] && FORCE_FLAG="--force"
  "$PY" build_for_pages.py $FORCE_FLAG 2>&1 | sed 's/^/    /' || {
    echo "    [跳过] 构建脚本报错"
  }
else
  echo "    [跳过] 未找到 Python"
fi

# 4. 提交
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

# 5. 推送（网络易抖动，重试 3 次）
echo ""
echo "[推送] 上传到 GitHub..."
PUSH_OK=0
for attempt in 1 2 3; do
  if git push "https://finealltheway:${TOKEN}@github.com/finealltheway/mba-exam-web.git" main 2>/dev/null; then
    PUSH_OK=1
    break
  fi
  echo "    第 $attempt 次失败，3 秒后重试..."
  sleep 3
done
if [ "$PUSH_OK" -ne 1 ]; then
  echo "[✗] 推送连续 3 次失败，请检查网络后重试"
  echo "    若网络不通，可开启代理后再运行本脚本"
  exit 1
fi
echo "[✓] 推送成功"

# 6. 清理 .git/config 里的 token（push 会写进去）
git remote set-url origin https://github.com/finealltheway/mba-exam-web.git
sed -i 's|^\tremote = https://finealltheway:ghp_[A-Za-z0-9]*@github.com/finealltheway/mba-exam-web.git$|\tremote = origin|' .git/config
echo "[✓] 已清理配置文件中的 token"

# 7. 查部署状态
echo ""
echo "[部署] 等待 GitHub Actions 完成..."
NODE="/c/Users/77158/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
for i in $(seq 1 12); do
  ST=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
    "https://api.github.com/repos/finealltheway/mba-exam-web/actions/workflows/deploy.yml/runs?per_page=1" \
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