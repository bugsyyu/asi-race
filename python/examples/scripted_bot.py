#!/usr/bin/env python3
"""一个只看得见迷雾内情报、用公开 API 打完整局的宏观机器人。

大脑 think() 是快照驱动的纯决策函数：喂 Game（无头）或 LiveGame（浏览器实况,
见 live_control.py --takeover）都能跑 —— 两种模式共享同一命令协议。

运行:
    python3 python/examples/scripted_bot.py --seed 42 --faction 0 --max-seconds 2400
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from asirace import Game, buildings_of, nearest, nodes_alive, units_of

MIL_TYPES = ("secops", "cyberops")
TECH_ORDER = ("brand", "optics", "pipeline", "drills", "oversight", "synth", "immersion")


def dist(a, b) -> float:
    return math.hypot(a["x"] - b["x"], a["z"] - b["z"])


def think(g, obs, mem) -> None:
    """One macro decision pass. `obs` must be a fog-honest observe() snapshot;
    `mem` is the bot's scratch memory (dict) carried between calls."""
    fid = g.faction
    me = obs["factions"][fid]
    if not me["alive"] or obs["over"]:
        return
    meta = g.meta
    now = obs["time"]

    my_units = [u for u in obs["units"] if u["fid"] == fid]
    workers = [u for u in my_units if u["type"] == "researcher"]
    military = [u for u in my_units if u["type"] in MIL_TYPES]
    lobbyists = [u for u in my_units if u["type"] == "lobbyist"]
    hqs = buildings_of(obs, fid, "hq")
    if not hqs:
        return
    hq = hqs[0]

    # --- 防守：视野里贴近园区的敌军，全军迎击 -------------------------------
    foes = [u for u in obs["units"] if u["fid"] != fid and dist(u, hq) < 34]
    if foes and military:
        g.attack([u["id"] for u in military], nearest(foes, hq["x"], hq["z"]))
        mem["defend_until"] = now + 8

    # --- 闲人上岗：先帮工地，再去最近的活矿 ---------------------------------
    sites = buildings_of(obs, fid, done=False)
    idle = [u for u in workers if u["state"] == "idle"]
    if idle:
        if sites:
            g.build_join(idle, sites[0])
        else:
            node = nearest(nodes_alive(obs), hq["x"], hq["z"])
            if node:
                g.gather(idle, node)

    # --- 研发阶梯 / ASI --------------------------------------------------------
    if me["gen"] < meta["maxGen"]:
        g.research_gen()  # 资源不够会被礼貌拒绝，无妨
    elif me["asi"]["state"] == "none":
        g.start_asi()

    # --- 建造（一次一个工地，选址与内置 AI 同款螺旋搜索）---------------------
    if not sites and now >= mem.get("build_cd", 0):
        want = _next_building(obs, me, mem)
        if want:
            spot = g.find_spot(want, hq["x"], hq["z"])
            if spot:
                crew = [u["id"] for u in workers if u["state"] != "build"][:2]
                r = g.build(want, spot["x"], spot["z"], builders=crew)
                mem["build_cd"] = now + (4 if r["ok"] else 10)

    # --- 训练 -------------------------------------------------------------------
    if len(workers) < 9 and len(hq["queue"]) < 2:
        g.train(hq, "researcher")
    sec = buildings_of(obs, fid, "secoffice", done=True)
    if sec and len(military) < 8 and len(sec[0]["queue"]) < 2:
        g.train(sec[0], "cyberops" if me["gen"] >= 2 else "secops")
    pol = buildings_of(obs, fid, "policy", done=True)
    if pol:
        cap = obs["capitol"]
        if not pol[0]["rally"]:
            g.rally(pol[0], cap["x"] + 6, cap["z"], target=cap["id"])
        if len(lobbyists) < 3 and len(pol[0]["queue"]) < 2:
            g.train(pol[0], "lobbyist")
    idle_lob = [u for u in lobbyists if u["state"] == "idle"]
    if idle_lob:
        g.channel(idle_lob)

    # --- 经济科技：按优先级买第一个可行的 -----------------------------------
    for key in TECH_ORDER:
        if key in me["techs"]:
            continue
        t = meta["techs"][key]
        needs = t.get("needs") or {}
        if needs.get("gen", 0) > me["gen"] or (needs.get("tech") and needs["tech"] not in me["techs"]):
            continue
        if me["compute"] < t["cost"].get("c", 0) + 60 or me["data"] < t["cost"].get("d", 0):
            continue
        home = next((b for b in buildings_of(obs, fid, t["at"], done=True) if not b["tech"]), None)
        if home:
            g.research_tech(home, key)
        break

    # --- 现货市场：为下一梯级补短板（带滑点，别上头）-------------------------
    if me["mktPressure"] < 0.4:
        goal = meta["gens"][me["gen"] + 1]["cost"] if me["gen"] < meta["maxGen"] else meta["asi"]["cost"]
        need_c = goal.get("c", 0) - me["compute"]
        need_d = goal.get("d", 0) - me["data"]
        if need_d > 0 and need_c < -340:
            g.trade("c2d")
        elif need_c > 0 and need_d < -290:
            g.trade("d2c")

    # --- 攻势：首波去占最近的 GPU 集群，之后骚扰代际领先的对手 ----------------
    if len(military) >= 6 and now >= mem.get("next_raid", 240) and now >= mem.get("defend_until", 0):
        ids = [u["id"] for u in military]
        if not mem.get("cluster_done"):
            cl = nearest(meta["map"]["clusters"], hq["x"], hq["z"])
            g.attack_move(ids, cl["x"], cl["z"])
            mem["cluster_done"] = True
        else:
            rivals = [f for f in obs["factions"] if f["id"] != fid and f["alive"]]
            if rivals:
                lead = max(rivals, key=lambda f: (f["gen"], f["stock"] or 0))
                pos = meta["map"]["hqPos"][lead["id"]]  # 园区座标是公开常识
                g.attack_move(ids, pos["x"], pos["z"])
        mem["next_raid"] = now + 150


def _next_building(obs, me, mem) -> str | None:
    fid = me["id"]
    n = lambda t: len(buildings_of(obs, fid, t))          # noqa: E731 含在建
    if n("lab") < 1:
        return "lab"
    if n("datacenter") < 2:
        return "datacenter"
    if n("secoffice") < 1 and (obs["time"] > 110 or me["gen"] >= 2):
        return "secoffice"
    if me["gen"] >= 2 and n("policy") < 1:
        return "policy"
    if me["risk"] > 40 and n("institute") < 1:
        return "institute"
    if n("datacenter") < 4:
        return "datacenter"
    if n("tower") < 1 and n("secoffice") >= 1:
        return "tower"
    if n("lab") < 3:
        return "lab"
    if me["risk"] > 60 and n("institute") < 2:
        return "institute"
    return None


def status_line(obs, fid) -> str:
    me = obs["factions"][fid]
    army = sum(1 for u in obs["units"] if u["fid"] == fid and u["type"] in MIL_TYPES)
    rivals = " ".join(
        f"{f['name'].split()[0]}:Gen{f['gen']}{'·ASI' if f['asi']['state'] == 'running' else ''}"
        for f in obs["factions"] if f["id"] != fid and f["alive"]
    )
    asi = f" ASI剩{me['asi']['remain']:.0f}s" if me["asi"]["state"] == "running" else ""
    return (f"[{obs['time']:6.0f}s] Gen-{me['gen']}{asi} ⚡{me['compute']:.0f}(+{me['computeRate']:.1f}/s) "
            f"◆{me['data']:.0f} ◇{me['influence']:.0f} 人才{me['talentUsed']}/{me['talentCap']} "
            f"军{army} 信任{me['trust']:.0f} 风险{me['risk']:.0f} | {rivals}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--faction", type=int, default=0, help="0=OpenAI 1=Anthropic 2=DeepMind 3=xAI")
    ap.add_argument("--difficulty", default="normal", choices=("chill", "normal", "brutal"))
    ap.add_argument("--max-seconds", type=float, default=2400.0)
    ap.add_argument("--think-every", type=float, default=2.0, help="决策间隔（模拟秒）")
    args = ap.parse_args()

    mem: dict = {}
    with Game(seed=args.seed, faction=args.faction, difficulty=args.difficulty) as g:
        print(f"seed={g.seed} 我是 {g.meta['factions'][args.faction]['name']}（{args.difficulty}）")
        next_report = 0.0
        while g.time < args.max_seconds:
            obs = g.observe()
            if obs["over"]:
                break
            think(g, obs, mem)
            if obs["time"] >= next_report:
                print(status_line(obs, args.faction))
                next_report = obs["time"] + 60
            g.step(seconds=args.think_every, events=False)

        over = g.over
        if not over:
            print(f"到 {g.time:.0f}s 竞赛仍未分胜负。")
            return 1
        w = g.meta["factions"][over["winner"]]["name"]
        how = "军事统一" if over.get("military") else ("对齐 ASI" if over.get("aligned") else "失控 ASI")
        mine = "🏆 我们赢了！" if over["winner"] == args.faction else "输给了对手。"
        print(f"[{g.time:6.0f}s] 竞赛结束：{w} 以「{how}」取胜。{mine}")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
