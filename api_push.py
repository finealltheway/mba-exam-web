#!/usr/bin/env python3
"""
REST API 兜底推送（update.sh 在 git push 连续失败时调用）

为什么需要它
------------
`git push` 上传 assets.js（3.9 MB）这类大文件时，在这条网络上会被
中途掐断（send-pack: unexpected disconnect / Failed to connect），
重试几次都未必成功。

而 Git Data API 是逐个 blob 上传，单请求体积小、不产生 packfile，
实测比 git push 稳得多。原理是四步：

    1. POST /git/blobs     每个改动文件传一次（base64）
    2. POST /git/trees      基于远端 tree，只列出改动的路径
    3. POST /git/commits    挂到远端最新 commit 之上
    4. PATCH /git/refs/...  移动 main 指针

注意：请求用 curl 发（不用 urllib）—— 本机沙箱里 Python 的 DNS 解析
会被拦，而 curl 正常。

用法：python api_push.py <token> "<提交说明>"
"""
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time

API = "https://api.github.com/repos/finealltheway/mba-exam-web"
BRANCH = "main"

# 请求体临时文件。放系统临时目录而不是仓库里——放仓库会被
# update.sh 的 git add -A 扫到，或与 .gitignore 规则打架。
PAYLOAD = os.path.join(tempfile.gettempdir(), "wbapi_payload.json")


def curl(method, url, payload=None, timeout=180, retries=4):
    """用 curl 发一个 GitHub API 请求，返回解析后的 JSON。

    这条网络对 GitHub 是间歇性阻断的（同一个 URL 可能连着三次好
    一次断），所以每个请求都要自动重试。HTTP 000 = 连接层就断了，
    必须重试；4xx/5xx 里的 502/503/429 同理；404 这类确定性错误
    直接抛出，重试也没用。
    """
    retryable_codes = ("000", "502", "503", "504", "429")

    for attempt in range(1, retries + 1):
        cmd = ["curl", "-s", "--http1.1", "--max-time", str(timeout),
               "-X", method,
               "-H", "Authorization: Bearer " + TOKEN,
               "-H", "Content-Type: application/json",
               "-H", "Expect:",          # 禁用 100-continue，大 body 更稳
               "-w", "\n%{http_code}"]

        # 请求体先落盘再交给 curl（--data-binary @file）。
        # 直接拼命令行传大 body 会被 shell 转义规则和长度上限坑到。
        if payload is not None:
            with open(PAYLOAD, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            cmd += ["--data-binary", "@" + PAYLOAD]

        cmd.append(url)

        r = subprocess.run(cmd, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        out = r.stdout or ""
        err = (r.stderr or "").strip()

        if "\n" not in out:
            # curl 根本没拿到响应（连接被掐），也算可重试
            if attempt < retries:
                print(f"      …连接中断，第 {attempt} 次重试", flush=True)
                time.sleep(2)
                continue
            raise RuntimeError(f"curl 失败：{err[:200]}")

        body, code = out.rsplit("\n", 1)
        code = code.strip()

        if code in ("200", "201"):
            return json.loads(body) if body.strip() else {}
        if code in retryable_codes and attempt < retries:
            print(f"      …HTTP {code}，第 {attempt} 次重试", flush=True)
            time.sleep(2)
            continue
        raise RuntimeError(f"HTTP {code}: {body[:300]}")

    raise RuntimeError("重试次数用尽")


def git(*args, binary=False):
    """执行本地 git 命令。"""
    r = subprocess.run(["git"] + list(args), cwd=REPO,
                       capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失败：{(r.stderr or r.stdout)[:300]}")
    return r.stdout if not binary else r.stdout


def blob_sha(path):
    """算 git blob 的 sha（内容 + "blob <长度>\\0" 前缀的 sha1）。

    直接对文件字节算，不经过 git——避免受 core.autocrlf 影响算出
    跟远端不一致的值。仓库有 .gitattributes 统一 LF，所以按原始
    字节算就是对的。
    """
    d = open(path, "rb").read()
    return hashlib.sha1(b"blob %d\0" % len(d) + d).hexdigest()


def main():
    global TOKEN, REPO
    if len(sys.argv) < 3:
        print("用法：python api_push.py <token> \"<提交说明>\"", file=sys.stderr)
        return 2
    TOKEN = sys.argv[1].strip()
    message = sys.argv[2]
    REPO = os.path.dirname(os.path.abspath(__file__))

    try:
        # ---- 基准：远端 main 当前指向的 commit ----
        # 注意不能拿本地 HEAD——本地往往比远端领先（这次更新的提交
        # 还没推上去），查远端会404。必须从 /git/refs 读远端真实 SHA。
        head = curl("GET", API + f"/git/ref/heads/{BRANCH}")["object"]["sha"]

        # ---- 找出本地相对远端有哪些文件变了 ----
        #   删掉的文件：git diff 比对远端 SHA 与工作区
        #   新增/修改：git diff --cached（update.sh 已经 add 过）
        changed = git("diff", "--name-only", "--cached", head).split()
        deleted = git("diff", "--name-only", "--diff-filter=D",
                      "--cached", head).split()

        changed = [p for p in changed if os.path.isfile(os.path.join(REPO, p))]
        deleted = [p for p in deleted if p not in changed]

        if not changed and not deleted:
            print("没有需要上传的改动")
            return 0

        print(f"  远端基准 {head[:12]}")
        print(f"  待上传 {len(changed)} 个文件"
              + (f"，删除 {len(deleted)} 个" if deleted else ""))

        # ---- 1. 逐个上传 blob ----
        entries = []
        for rel in changed:
            path = os.path.join(REPO, rel)
            size = os.path.getsize(path)
            print(f"  · {rel} ({size:,} 字节)", flush=True)
            with open(path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode()
            sha = curl("POST", API + "/git/blobs", {"content": b64, "encoding": "base64"})["sha"]
            # 和本地算的对不上就说明传错了，宁可失败也别推坏内容
            if sha != blob_sha(path):
                raise RuntimeError(f"{rel} 上传后 sha 不一致（{sha[:12]}），已中止")
            mode = "100755" if rel.endswith(".sh") else "100644"
            entries.append({"path": rel, "mode": mode, "type": "blob", "sha": sha})
            print(f"      ✓ {sha[:12]}", flush=True)

        for rel in deleted:
            print(f"  · 删除 {rel}")
            entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": None})

        # ---- 2. 组tree ----
        base = curl("GET", API + f"/git/commits/{head}")["tree"]["sha"]
        tree = curl("POST", API + "/git/trees",
                    {"base_tree": base, "tree": entries})["sha"]
        print(f"  tree {tree[:12]}", flush=True)

        # ---- 3. 建 commit ----
        c = curl("POST", API + "/git/commits",
                 {"message": message, "tree": tree, "parents": [head]})
        csha = c["sha"]
        print(f"  commit {csha[:12]}")

        # ---- 4. 移动 main ----
        curl("PATCH", API + f"/git/refs/heads/{BRANCH}", {"sha": csha, "force": False})
        print(f"  main -> {csha[:12]}", flush=True)
        return 0

    except Exception as e:
        print(f"\n  [失败] {e}", file=sys.stderr)
        return 1
    finally:
        if os.path.exists(PAYLOAD):
            try:
                os.remove(PAYLOAD)
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())