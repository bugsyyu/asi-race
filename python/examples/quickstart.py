#!/usr/bin/env python3
"""asirace 快速上手 — 无头模式 API 之旅 / headless API tour.

运行（仓库根目录，需要 Node.js ≥ 18）:
    python3 python/examples/quickstart.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # add python/ to the path
from asirace import Game, buildings_of, nearest, nodes_alive, units_of

# 阵营: 0=OpenAI 1=Anthropic 2=Google DeepMind 3=xAI
with Game(seed=7, faction=0, difficulty="normal") as g:
    obs = g.observe()                                   # 战争迷雾视角的快照
    print(f"seed={g.seed}  我的阵营={obs['factions'][g.faction]['name']}  迷雾诚实={not obs['omniscient']}")

    hq = buildings_of(obs, g.faction, "hq")[0]
    workers = units_of(obs, g.faction, "researcher")
    node = nearest(nodes_alive(obs), hq["x"], hq["z"])
    print("gather:", g.gather(workers, node))           # 研究员去采数据
    print("train :", g.train(hq, "researcher"))         # 总部训练一名研究员

    r = g.step(seconds=45, events=True)                 # 推进模拟 45 秒（450 个固定步）
    print(f"t={r['time']}s  期间事件 {len(r['events'])} 条")

    me = g.observe()["factions"][g.faction]
    print(f"算力={me['compute']:.0f}(+{me['computeRate']:.1f}/s)  数据={me['data']:.0f}  "
          f"人才={me['talentUsed']}/{me['talentCap']}  信任={me['trust']:.0f}")

    spot = g.find_spot("lab", hq["x"], hq["z"])         # 智能选址（与内置 AI 同一套螺旋搜索）
    if spot:
        print("build :", g.build("lab", spot["x"], spot["z"], builders=workers[:2]))
    g.step(seconds=30)

    obs = g.observe()
    labs = buildings_of(obs, g.faction, "lab")
    print("实验楼:", [(b["id"], b["done"], b["progress"]) for b in labs])
    print("对手公开情报:", [(f["name"], f"Gen-{f['gen']}", f"股价{f['stock']}")
                        for f in obs["factions"] if f["id"] != g.faction])
    # 想要上帝视角（写分析工具、做录像）用 g.state()；训练智能体请坚持 g.observe()。
