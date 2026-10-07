"""构建 GitHub Pages 友好版本。

GitHub Pages 是纯静态托管，无法 fetch() 外部 JSON。本脚本读取
data/question_bank.json 并内联成 window.BANK_DATA，使页面无需服务器即可加载题库。

注意：全局变量名必须是 BANK_DATA —— engine.js 的 getBank() 读的就是它，
写成其他名字会静默回退到 fetch，页面能开但题目全空。

用法：
    python build_for_pages.py           # 已有内联数据则跳过
    python build_for_pages.py --force   # 强制重建（index.html 被覆盖后需用）
"""
import argparse
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent

MARKER = "window.BANK_DATA="


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--force",
        action="store_true",
        help="即使已内联也强制重建（index.html 从开发目录覆盖过来后必须用）",
    )
    args = ap.parse_args()

    index = ROOT / "index.html"
    bank_file = ROOT / "data" / "question_bank.json"

    if not bank_file.exists():
        print(f"[ERR] 找不到 {bank_file}")
        return 1
    if not index.exists():
        print(f"[ERR] 找不到 {index}")
        return 1

    bank = json.loads(bank_file.read_text(encoding="utf-8"))

    count = len(bank) if isinstance(bank, list) else sum(
        len(v) for v in bank.values() if isinstance(v, list)
    )

    html = index.read_text(encoding="utf-8")

    if MARKER in html and not args.force:
        print("[SKIP] index.html 已内联题库，无需重复注入（--force 可强制重建）")
        return 0

    # 强制模式下先把旧的注入块整段清掉，避免叠加
    if args.force and MARKER in html:
        start = html.find("<script>window.BANK_DATA=")
        if start != -1:
            end = html.find("</script>", start)
            if end != -1:
                html = html[:start] + html[end + len("</script>"):]
                print("[清理] 已移除旧的题库注入块")

    payload = json.dumps(bank, ensure_ascii=False, separators=(",", ":"))
    tag = "<script>" + MARKER + payload + ";</script>"

    marker = '<script src="assets.js" onerror="void 0"></script>'
    if marker not in html:
        print("[ERR] 未找到 assets.js 注入点，无法安全插入题库")
        return 1

    html = html.replace(marker, tag + "\n" + marker, 1)
    index.write_text(html, encoding="utf-8")

    size_kb = len(payload.encode("utf-8")) / 1024
    print(f"[OK] 已内联题库：{count} 题，{size_kb:.0f} KB -> {index.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())