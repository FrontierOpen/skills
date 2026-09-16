import re
import unittest
from pathlib import Path


PROBE_HTML = Path(__file__).resolve().parents[6] / "wx-mp-engagement-probe" / "02_list.html"
SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "fetch_engagement.py"
TARGET = "ChatGPT开始放广告，你的聊天会被拿去推荐吗？"


class CreatorCenterDomRegressionTests(unittest.TestCase):
    def test_probe_target_uses_title_anchor_and_metric_classes(self):
        if not PROBE_HTML.exists():
            self.skipTest("live probe artifact is not present")
        html = PROBE_HTML.read_text(encoding="utf-8")
        pos = html.index(TARGET)
        card_start = html.rfind('<div class="weui-desktop-mass-appmsg"', 0, pos)
        card_end = html.find('<div class="weui-desktop-mass-appmsg"', pos)
        card = html[card_start:card_end if card_end >= 0 else len(html)]
        self.assertIn('class="weui-desktop-mass-appmsg__title"', card)
        self.assertIn('class="weui-desktop-mass-media__data appmsg-view"', card)
        self.assertIn('class="weui-desktop-mass-media__data appmsg-like"', card)
        self.assertIn('class="weui-desktop-mass-media__data appmsg-share"', card)
        self.assertIn('class="weui-desktop-mass-media__data appmsg-haokan"', card)
        self.assertIn('class="weui-desktop-mass-media__data appmsg-comment"', card)
        # Regression guard: this article has no separate type line in the DOM.
        self.assertNotRegex(card, r">(?:转载|原创|视频号)<")

    def test_parser_contains_dom_fallback_for_badge_inside_title(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("weui-desktop-mass-appmsg__title", source)
        self.assertIn("weui-desktop-key-tag", source)
        self.assertIn("appmsg-haokan", source)
        self.assertIn("compatibility fallback", source)


if __name__ == "__main__":
    unittest.main()
