#!/bin/bash
# ASI 竞赛 — 终端启动版（与双击 ASI竞赛.app 效果相同，日志直接可见）
# 停止方式：在弹出的对话框点"停止并退出"，或直接关闭本终端窗口。
cd "$(dirname "$0")"
exec './ASI竞赛.app/Contents/MacOS/run'
