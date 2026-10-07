"""构建 GitHub Pages 友好版本。

GitHub Pages 是纯静态托管，无法fetch() 外部 JSON。读取
data/question_bank.json 并内联成 window.QUESTION_BANK，使页面无需服务器即可加载题库。
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def main() -> int:
    index = ROOT / "index.html"
    bank_file = ROOT / "data" / "question_bank.json"

    if not bank_file.exists():
        print(f"[ERR] 找不到 {bank_file}")
        return 1

    bank = json.loads(bank_file.read_text(encoding="utf-8"))

    # 统计题量，便于核对
    count = 0
    if isinstance(bank, dict):
        for key, val in bank.items():
            if isinstance(val, list):
                count += len(val)
    elif isinstance(bank, list):
        count = len(bank)

    payload = json.dumps(bank, ensure_ascii=False, separators=(",", ":"))
    tag = (
        "<script>window.QUESTION_BANK="
        + payload
        + ";</script>"
    )

    html = index.read_text(encoding="utf-8")

    if "window.QUESTION_BANK" in html:
        print("[SKIP] index.html 已内联题库，无需重复注入")
        return 0

    marker = '<script src="assets.js" onerror="void 0"></script>'
    if marker not in html:
        # 退化：在 assets.js 引用之前插入
        marker = '<script src="assets.js" onerror="void 0"></script>'
        if marker not in html:
            print("[ERR] 未找到 assets.js 注入点，无法安全插入题库")
            return 1

    html = html.replace(marker, tag + "\n" + marker, 1)
    index.write_text(html, encoding="utf-8")

    size_kb = len(payload.encode("utf-8")) / 1024
    print(f"[OK] 已内联题库：{count} 题，{size_kb:.0f} KB -> {index}")
    return 0


if __name__ == "__main__":
    sys.exit(main())