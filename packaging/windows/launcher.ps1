# ============================================================================
# ASI 竞赛 — Windows 一键启动器（只用系统自带组件，无需安装任何依赖）
#   1) 首次联网运行时自动下载 vendor/three.module.js（约 1.2 MB，仅此一次）
#   2) 用 .NET TcpListener 在 127.0.0.1 起一个迷你静态服务器
#      （仅回环监听：不需要管理员权限，也不会触发防火墙弹窗）
#   3) 打开默认浏览器进入游戏；关闭本窗口即停止
# 调试用环境变量：ASI_PORT=端口  ASI_NO_OPEN=1
# ============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # PS5.1 的进度条会显著拖慢下载
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$Log = Join-Path ([IO.Path]::GetTempPath()) 'asi-race-launch.log'
function Log($m) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Host $line
  try { Add-Content -LiteralPath $Log -Value $line -Encoding UTF8 } catch { }
}
try { Add-Content -LiteralPath $Log -Value ('---- {0} ----' -f (Get-Date)) -Encoding UTF8 } catch { }

# ---------------------------------------------------------------------------
# 定位游戏目录（launcher.ps1 位于 app\ 下，游戏在 app\game\）
# ---------------------------------------------------------------------------
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Game = Join-Path $Root 'game'
if (-not (Test-Path -LiteralPath (Join-Path $Game 'index.html'))) {
  Log '错误：找不到 game\index.html —— 请保持解压后的目录结构完整。'
  exit 1
}
$GameFull = (Get-Item -LiteralPath $Game).FullName

# ---------------------------------------------------------------------------
# ① 确保 three.module.js 就位（首次需联网；之后完全离线）
# ---------------------------------------------------------------------------
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls13 } catch { }

$VenDir = Join-Path $Game 'vendor'
$Ven = Join-Path $VenDir 'three.module.js'
$need = $true
if (Test-Path -LiteralPath $Ven) {
  if ((Get-Item -LiteralPath $Ven).Length -gt 400000) { $need = $false }
}
if ($need) {
  New-Item -ItemType Directory -Force -Path $VenDir | Out-Null
  $urls = @(
    'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'https://fastly.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'https://unpkg.com/three@0.170.0/build/three.module.js'
  )
  foreach ($u in $urls) {
    $tmp = $Ven + '.download'
    Log ('下载引擎文件：{0}' -f $u)
    try {
      Invoke-WebRequest -Uri $u -OutFile $tmp -UseBasicParsing -TimeoutSec 90
      $len = (Get-Item -LiteralPath $tmp).Length
      if ($len -gt 400000) {
        Move-Item -Force -LiteralPath $tmp -Destination $Ven
        Log ('下载完成（{0} 字节）。之后即可完全离线游玩。' -f $len)
        break
      }
      Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    } catch {
      Log ('  失败：{0}' -f $_.Exception.Message)
      Remove-Item -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
  }
}
if (-not (Test-Path -LiteralPath $Ven)) {
  Log ''
  Log '⚠ 首次运行需要联网一次，以下载 three.js 引擎文件（约 1.2 MB）。'
  Log '  本次下载失败 —— 仍会打开游戏页面，页面内有同样的中文说明。'
  Log '  联网后重新双击启动器即可自动补齐；或按 app\game\vendor\README.txt 手动放置。'
  Log ''
}

# ---------------------------------------------------------------------------
# ② 在空闲端口上启动仅回环的迷你 HTTP 服务器
# ---------------------------------------------------------------------------
$ports = @()
if ($env:ASI_PORT) { $ports = @([int]$env:ASI_PORT) } else { $ports = 8423..8467 }
$listener = $null
$port = 0
foreach ($p in $ports) {
  try {
    $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p)
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch { }
}
if ($null -eq $listener) {
  Log '错误：8423–8467 端口全部被占用。设置环境变量 ASI_PORT 指定其他端口后重试。'
  exit 1
}
$url = 'http://127.0.0.1:' + $port + '/'

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.wasm' = 'application/wasm'
}

# ---------------------------------------------------------------------------
# ③ 打开浏览器
# ---------------------------------------------------------------------------
Log ('本地服务器已就绪：{0}' -f $url)
if ($env:ASI_NO_OPEN -ne '1') {
  try { Start-Process $url | Out-Null } catch { Log ('自动打开浏览器失败，请手动访问：{0}' -f $url) }
}
Write-Host ''
Write-Host '  ================================================='
Write-Host ('   游戏正在本机运行：{0}' -f $url)
Write-Host '   关闭本窗口（或按 Ctrl+C）即停止游戏服务器。'
Write-Host '  ================================================='
Write-Host ''

# ---------------------------------------------------------------------------
# ④ 请求循环（GET/HEAD，逐个处理 —— 本地小文件足够快）
# ---------------------------------------------------------------------------
while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
    $reqLine = $reader.ReadLine()
    while ($true) {
      $h = $reader.ReadLine()
      if ($null -eq $h) { break }
      if ($h -eq '') { break }
    }
    if ([string]::IsNullOrEmpty($reqLine)) { $client.Close(); $client = $null; continue }

    $parts = $reqLine -split ' +'
    $method = $parts[0].ToUpper()
    $raw = '/'
    if ($parts.Length -gt 1) { $raw = $parts[1] }
    $path = [Uri]::UnescapeDataString(($raw -split '\?')[0])
    if ($path -eq '/') { $path = '/index.html' }

    $status = 200
    $ctype = 'application/octet-stream'
    $body = $null
    if (($method -ne 'GET') -and ($method -ne 'HEAD')) {
      $status = 405
      $ctype = 'text/plain; charset=utf-8'
      $body = [Text.Encoding]::UTF8.GetBytes('method not allowed')
    } elseif ($path.Contains('..')) {
      $status = 400
      $ctype = 'text/plain; charset=utf-8'
      $body = [Text.Encoding]::UTF8.GetBytes('bad path')
    } else {
      $rel = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
      $full = [IO.Path]::GetFullPath((Join-Path $GameFull $rel))
      if ($full.StartsWith($GameFull) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $body = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLower()
        if ($Mime.ContainsKey($ext)) { $ctype = $Mime[$ext] }
      } else {
        $status = 404
        $ctype = 'text/plain; charset=utf-8'
        $body = [Text.Encoding]::UTF8.GetBytes('404 not found: ' + $path)
      }
    }

    $sl = '200 OK'
    if ($status -eq 404) { $sl = '404 Not Found' }
    if ($status -eq 405) { $sl = '405 Method Not Allowed' }
    if ($status -eq 400) { $sl = '400 Bad Request' }
    $hdr = 'HTTP/1.1 ' + $sl + "`r`n" +
           'Content-Type: ' + $ctype + "`r`n" +
           'Content-Length: ' + $body.Length + "`r`n" +
           "Cache-Control: no-cache`r`n" +
           "Connection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($hdr)
    $stream.Write($hb, 0, $hb.Length)
    if ($method -eq 'GET') { $stream.Write($body, 0, $body.Length) }
    $stream.Flush()
    if ($status -ne 200) { Log ($method + ' ' + $path + ' -> ' + $status) }
  } catch {
    try { Log ('连接处理异常：' + $_.Exception.Message) } catch { }
  } finally {
    if ($null -ne $client) { try { $client.Close() } catch { } }
  }
}
