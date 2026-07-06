#!/usr/bin/env python3
"""观战或接管一局正在浏览器里运行的游戏。

步骤:
  1. 启动静态服务器（仓库根目录）:  python3 -m http.server 8000
  2. 浏览器打开:                    http://localhost:8000/?bridge=8765
     （点「开始竞赛」进入对局；页面每 2 秒自动重连，本脚本先后启动均可）
  3. 运行本脚本:
       python3 python/examples/live_control.py                # 观战：打印实时战报
       python3 python/examples/live_control.py --takeover 3   # 接管 xAI，机器人代打
       python3 python/examples/live_control.py --follow       # 战报 + 镜头自动追事件
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from asirace import LiveGame  # noqa: E402
from scripted_bot import think  # noqa: E402  同一个大脑，无头/实况通用

EV_LABEL = {
    "raid": "⚔ 突袭出发", "capture": "🚩 GPU 集群易主", "incident": "⚠ 安全事故",
    "gen_done": "📈 模型代际完成", "asi_start": "🚀 ASI 训练启动", "asi_half": "⏳ ASI 训练过半",
    "emerge": "🌊 涌现阶段", "policy": "⚖ 政策落地", "defect": "↷ 研究员跳槽",
    "lum_jump": "🎓 明星研究员跳槽", "lum_quit": "🎓 明星研究员退圈", "lum_found": "🏢 明星研究员创业",
    "ipo": "💰 创业公司 IPO", "acquired": "🤝 创业公司被收购", "industry": "🌐 行业事件",
    "brownout": "🔌 电网容量挤兑", "ward": "🛡 防御性披露", "convert": "🕵 内线倒戈",
    "building_died": "💥 建筑被摧毁", "elim": "💀 阵营覆灭", "victory": "🏁 竞赛结束",
}
FOLLOW = {"raid", "incident", "capture", "asi_start", "brownout", "elim"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--takeover", type=int, default=None, help="接管该阵营（0-3），停用其内置 AI")
    ap.add_argument("--follow", action="store_true", help="镜头自动飞向大事件")
    ap.add_argument("--think-every", type=float, default=2.0, help="接管模式的决策间隔（真实秒）")
    args = ap.parse_args()

    g = LiveGame(port=args.port, faction=args.takeover)
    names = {f["id"]: f["name"] for f in g.meta["factions"]}
    print(f"已连接浏览器。玩家阵营: {names.get(g._t.hello.get('playerFaction', -1), '（观战）')}")

    g.subscribe(events=True)
    mem: dict = {}
    if args.takeover is not None:
        g.set_ai(args.takeover, False)
        print(f"已接管 {names[args.takeover]} — 内置 AI 停用，scripted_bot 上线。Ctrl-C 退出。")

    last_think = 0.0
    try:
        while True:
            for push in g.poll(timeout=0.5):
                if push.get("push") != "events":
                    continue
                for ev in push["events"]:
                    label = EV_LABEL.get(ev["t"])
                    if not label:
                        continue
                    who = names.get(ev.get("fid", ev.get("from", -1)), "")
                    print(f"[{push['time']:7.1f}s] {label} {who} "
                          f"{json.dumps({k: v for k, v in ev.items() if k not in ('t', 'time')}, ensure_ascii=False)}")
                    if args.follow and ev["t"] in FOLLOW and "x" in ev:
                        g.center(ev["x"], ev["z"])
                    if ev["t"] == "victory":
                        print(f"胜者: {names.get(ev.get('winner'), '?')}")
                        return 0
            if args.takeover is not None and time.monotonic() - last_think >= args.think_every:
                last_think = time.monotonic()
                think(g, g.observe(args.takeover), mem)
    except KeyboardInterrupt:
        if args.takeover is not None:
            g.set_ai(args.takeover, True)  # 走时把钥匙还给内置 AI
            print("\n已交还内置 AI。")
    finally:
        g.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
