#!/usr/bin/env python3
"""publish_wx_mp.py — 推送 Markdown 稿件到微信公众号草稿箱（官方 API direct）

Usage:
  python3 publish_wx_mp.py <markdown_file> [theme] [--account ALIAS]
  python3 publish_wx_mp.py <markdown_file> [theme] --transport direct [--debug-schema]

凭据：从同级 ../accounts.json 读取（多账号，由 Agent 帮用户维护）。
直接发布：由本地 Node 端直接调用微信公众号官方 API。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
# 凭据放在源仓之外（实例态目录），避免软链模式下密钥落进源仓工作树
ACCOUNTS_FILE = Path.home() / ".openclaw" / "wx-mp-publisher" / "accounts.json"
PUBLISHER_DIR = SCRIPT_DIR.parent
TOOLS_DIR = PUBLISHER_DIR.parent
EXPERT_PACK_DIR = TOOLS_DIR.parent
SKILLS_DIR = EXPERT_PACK_DIR.parent
CREW_WORKSPACE = SKILLS_DIR.parent
THEME_ROOT = CREW_WORKSPACE / "wenyan-theme"
THEME_INDEX = THEME_ROOT / "index.json"


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def log(msg: str) -> None:
    print(f">>> {msg}", flush=True)


# ── 凭据 ─────────────────────────────────────────────────────────────────────

def load_account(alias_arg: str | None) -> tuple[str, str, str]:
    """返回 (alias, appId, appSecret)。alias_arg 为 None 时用 default。"""
    if not ACCOUNTS_FILE.exists():
        die(
            "未找到公众号凭据文件 accounts.json。\n"
            f"  位置：{ACCOUNTS_FILE}\n"
            "  → 请让 Agent 帮你创建并填入公众号 AppID/AppSecret（获取方式见 wx-mp-publisher SKILL 同目录 REFERENCE.md）"
        )
    try:
        cfg = json.loads(ACCOUNTS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"accounts.json 解析失败: {e}")

    accounts = cfg.get("accounts") or []
    if not accounts:
        die("accounts.json 中没有账号。请让 Agent 帮你填入公众号 AppID/AppSecret（见 REFERENCE.md）。")

    if alias_arg:
        target = next((a for a in accounts if a.get("alias") == alias_arg), None)
        if not target:
            names = ", ".join(a.get("alias", "?") for a in accounts)
            die(f"未找到账号 alias={alias_arg}。现有账号: {names}")
    else:
        default_alias = cfg.get("default", "")
        if not default_alias:
            if len(accounts) == 1:
                target = accounts[0]
            else:
                names = ", ".join(a.get("alias", "?") for a in accounts)
                die(f"存在多账号但未指定 default，且未传 --account。现有账号: {names}")
        else:
            target = next((a for a in accounts if a.get("alias") == default_alias), None)
            if not target:
                die(f"accounts.json default={default_alias!r} 在 accounts 中不存在。")

    app_id = (target.get("appId") or "").strip()
    app_secret = (target.get("appSecret") or "").strip()
    alias = target.get("alias", "?")
    if not app_id or not app_secret:
        die(f"账号 {alias!r} 缺少 appId 或 appSecret。请让 Agent 补全（见 REFERENCE.md）。")
    return alias, app_id, app_secret


# ── 主题解析 ──────────────────────────────────────────────────────────────────

def _resolve_registered_theme_path(theme_id: str) -> Path | None:
    """从 wenyan-theme/index.json 查登记的主题 id，返回受控 CSS 路径或 None。

    注册表结构：
      {"version": 1, "themes": [{"id": "...", "css": "wenyan-theme/....css", ...}]}
    """
    if not THEME_INDEX.exists():
        return None

    try:
        registry = json.loads(THEME_INDEX.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        die(f"主题注册表解析失败: {THEME_INDEX}: {e}")

    themes = registry.get("themes") if isinstance(registry, dict) else None
    if not isinstance(registry, dict) or registry.get("version") != 1 or not isinstance(themes, list):
        die(f"主题注册表格式错误: {THEME_INDEX}，需要 version=1 和 themes 数组")

    for theme in themes:
        if not isinstance(theme, dict) or theme.get("id") != theme_id:
            continue
        css = theme.get("css")
        if not isinstance(css, str) or not css:
            die(f"主题 {theme_id!r} 缺少 css 路径: {THEME_INDEX}")
        css_path = Path(css)
        if css_path.is_absolute() or css_path.suffix != ".css":
            die(f"主题 {theme_id!r} 的 css 必须是 wenyan-theme/ 下的相对 .css 路径")
        resolved_root = THEME_ROOT.resolve()
        resolved_path = (CREW_WORKSPACE / css_path).resolve()
        try:
            resolved_path.relative_to(resolved_root)
        except ValueError:
            die(f"主题 {theme_id!r} 的 css 路径越界: {css}")
        if not resolved_path.is_file():
            die(f"主题 {theme_id!r} 的 CSS 文件不存在: {resolved_path}")
        return resolved_path
    return None


def resolve_theme(theme_arg: str | None) -> tuple[str, str] | None:
    """返回 ('theme', id) / ('custom_theme', css_text) / None。

    解析顺序：
      1. theme_arg 为空 → None
      2. 以 .css 结尾且是本地文件 → custom_theme（CSS 文本）
      3. wenyan-theme/index.json 登记的自定义 id → 解析 CSS 路径 → custom_theme
      4. 其它 → 内置主题 id，原样作为 theme
    """
    if not theme_arg:
        return None
    p = Path(theme_arg)
    if theme_arg.endswith(".css") and p.is_file():
        return ("custom_theme", p.read_text(encoding="utf-8"))
    css_path = _resolve_registered_theme_path(theme_arg)
    if css_path is not None:
        return ("custom_theme", css_path.read_text(encoding="utf-8"))
    return ("theme", theme_arg)


# ── multipart 构建 ───────────────────────────────────────────────────────────

def build_multipart(fields: dict[str, str], files: list[tuple[str, Path]]) -> tuple[bytes, str]:
    """手动构造 multipart/form-data，返回 (body, content_type)。文本字段按 utf-8 原样写入（不 base64）。"""
    import mimetypes
    import uuid

    boundary = uuid.uuid4().hex
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode("utf-8")
            + value.encode("utf-8") + b"\r\n"
        )
    for name, path in files:
        ctype, _ = mimetypes.guess_type(str(path))
        if ctype is None:
            ctype = "application/octet-stream"
        with open(path, "rb") as f:
            file_data = f.read()
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{path.name}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n".encode("utf-8")
            + file_data + b"\r\n"
        )
    body = b"".join(parts) + f"--{boundary}--\r\n".encode("ascii")
    content_type = f"multipart/form-data; boundary={boundary}"
    return body, content_type


def _frontmatter_local_refs(md_text: str) -> list[str]:
    """从 YAML frontmatter 提取 cover / image_list 里的本地图片引用（原始字符串）。"""
    if not md_text.startswith("---"):
        return []
    end = md_text.find("\n---", 3)
    if end < 0:
        return []
    refs: list[str] = []
    in_image_list = False
    for line in md_text[3:end].splitlines():
        m = re.match(r"^\s*cover:\s*(\S+)", line)
        if m:
            refs.append(m.group(1))
            in_image_list = False
            continue
        if re.match(r"^\s*image_list:\s*$", line):
            in_image_list = True
            continue
        if re.match(r"^\s*image_list:\s*\S", line):
            in_image_list = False
            continue
        if in_image_list:
            m = re.match(r"^\s*-\s+(\S+)", line)
            if m:
                refs.append(m.group(1))
            elif re.match(r"^\S", line):
                in_image_list = False
    return refs


def extract_local_images(md_text: str, md_dir: Path) -> list[Path]:
    """从 markdown 提取本地图片路径：正文 ![]() + frontmatter cover / image_list。

    http/https/data: 跳过（由微信/本地渲染链路自行处理）。
    """
    out: list[Path] = []
    seen: set[Path] = set()

    def add(src: str) -> None:
        if src.startswith(("http://", "https://", "data:")):
            return
        p = Path(src) if Path(src).is_absolute() else (md_dir / src).resolve()
        if p.is_file() and p not in seen:
            seen.add(p)
            out.append(p)

    for m in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", md_text):
        add(m.group(1).split()[0])  # 去掉可选 title
    for ref in _frontmatter_local_refs(md_text):
        add(ref)
    return out


def rewrite_image_refs(md_text: str, local_images: list[Path], md_dir: Path) -> str:
    """把本地图片引用重写为 basename，与 images multipart 文件名对齐。

    direct 渲染时按文件名匹配上传的 images，带目录前缀或绝对路径会导致本地
    目标文件解析失败。覆盖 markdown / frontmatter 里可能出现的所有形式：绝对路径、
    `./name`、`name`、以及相对 md_dir 的子目录路径（如 `images/x.jpg`）。
    """
    if not local_images:
        return md_text
    for img in local_images:
        name = img.name
        candidates = {str(img), f"./{name}", name}
        try:
            candidates.add(str(img.relative_to(md_dir)))
        except ValueError:
            pass
        for original in candidates:
            if original != name:
                md_text = md_text.replace(original, name)
    return md_text


# ── 发布前校验 ─────────────────────────────────────────────────────────────

# 微信草稿 author 字段上限：8 个汉字 / 24 字节（errcode 45110: author size out of limit）
WX_AUTHOR_MAX_BYTES = 24


def _parse_frontmatter_author(md_text: str) -> str | None:
    """从 YAML frontmatter 提取 author 字段值（去首尾引号）；无则返回 None。"""
    if not md_text.startswith("---"):
        return None
    end = md_text.find("\n---", 3)
    if end < 0:
        return None
    for line in md_text[3:end].splitlines():
        m = re.match(r"^\s*author:\s*(.+?)\s*$", line)
        if m:
            val = m.group(1).strip()
            if (val.startswith('"') and val.endswith('"')) or (
                val.startswith("'") and val.endswith("'")
            ):
                val = val[1:-1]
            return val
    return None


def validate_for_publish(md_text: str) -> None:
    """发布前校验，命中违规即 die() 拦截，避免微信侧报错。

    1. 本地图片引用必须用纯文件名（basename），不得含目录前缀或绝对路径。
    2. frontmatter author 字段 ≤ 24 字节（8 个汉字）。
    """
    # 1. 图片引用：正文 ![]() + frontmatter cover/image_list
    local_refs = [
        m.group(1).split()[0] for m in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", md_text)
    ]
    local_refs += _frontmatter_local_refs(md_text)
    bad_imgs = [
        ref
        for ref in local_refs
        if not ref.startswith(("http://", "https://", "data:"))
        and ("/" in ref or "\\" in ref or Path(ref).is_absolute())
    ]
    if bad_imgs:
        die(
            "图片引用必须用纯文件名（与上传时的 originalname 一致），不得带目录前缀或绝对路径。\n"
            "  直接发布时会按原始文件名匹配上传素材，带目录前缀的路径会在本地解析阶段失败。\n"
            "  请改为 basename：\n    "
            + "\n    ".join(bad_imgs)
        )

    # 2. author 长度
    author = _parse_frontmatter_author(md_text)
    if author is not None:
        n = len(author.encode("utf-8"))
        if n > WX_AUTHOR_MAX_BYTES:
            die(
                f"frontmatter author 超过微信草稿上限（{WX_AUTHOR_MAX_BYTES} 字节 / 8 个汉字），"
                f"当前 {n} 字节：{author!r}。请缩短 author 字段。"
            )


# ── 主流程 ───────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="推送 Markdown 到微信公众号草稿箱（官方 API direct）")
    parser.add_argument("markdown_file", help="Markdown 文件路径")
    parser.add_argument(
        "theme", nargs="?", default=None,
        help="主题：本地 .css 路径 / wenyan-theme/index.json 登记的自定义 id",
    )
    parser.add_argument("--account", default=None, help="指定公众号 alias（缺省用 accounts.json 的 default）")
    parser.add_argument("--transport", choices=("direct",), default="direct", help="传输方式：direct（微信公众号官方 API，仅草稿箱）")
    parser.add_argument("--dry-run", action="store_true", help="本地校验/渲染预演；不发起任何网络请求")
    parser.add_argument("--update-media-id", default=None, help="覆盖指定已有草稿的第 0 篇文章；不会群发")
    parser.add_argument("--debug-schema", action="store_true", help="请求草稿更新前输出脱敏 payload schema（不含正文、ID、token 或密钥）")
    args = parser.parse_args()

    md_path = Path(args.markdown_file)
    if not md_path.is_file():
        die(f"文件不存在: {md_path}")

    direct = SCRIPT_DIR / "direct_wx_mp.mjs"
    cmd = ["node", str(direct), str(md_path), "--transport", "direct"]
    if args.account:
        cmd += ["--account", args.account]
    if args.dry_run:
        cmd.append("--dry-run")
    if args.update_media_id is not None:
        cmd += ["--update-media-id", args.update_media_id]
    if args.debug_schema:
        cmd.append("--debug-schema")
    env = os.environ.copy()
    if args.theme:
        direct_theme = Path(args.theme)
        if not (args.theme.endswith(".css") and direct_theme.is_file()):
            candidate = Path.home() / ".openclaw" / "workspace-main" / "wx_mp" / "wenyan-theme" / f"{args.theme}.css"
            if not candidate.is_file():
                die(f"direct 模式找不到主题 CSS：{args.theme}（请传 .css 路径或工作区 wenyan-theme 中的主题 id）")
            direct_theme = candidate
        env["WX_MP_FRONTIER_CSS"] = str(direct_theme.resolve())
    raise SystemExit(subprocess.run(cmd, check=False, env=env).returncode)


if __name__ == "__main__":
    main()
