# Bi-Tunnel Mobile App 搭建指南

## 前置条件

- Flutter SDK 3.x (推荐 3.19+)
- Android Studio + Android SDK (API 34+)
- (可选) macOS + Xcode 用于 iOS 构建

## 快速开始

```bash
# 1. 在 mobile 目录下初始化 Flutter 项目
cd mobile
flutter create --org com.bitunnel --project-name bi_tunnel_mobile .

# 2. 会提示文件冲突，覆盖即可（我们的文件是定制的）

# 3. 安装依赖
flutter pub get

# 4. Android: 生成 silent audio 文件
# iOS 静默音频保活需要一段极短的静音 mp3
# 可用 ffmpeg 生成：
# ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.1 -q:a 9 silence.mp3
# 放入 ios/Runner/ 目录

# 5. 运行
flutter run
```

## 项目结构

```
mobile/
├── lib/
│   ├── main.dart                      # 入口
│   ├── app.dart                       # MaterialApp
│   ├── models/
│   │   ├── connection_config.dart     # 连接配置模型
│   │   └── tunnel_status.dart         # 隧道状态模型
│   ├── services/
│   │   ├── platform_service.dart      # MethodChannel 桥接
│   │   └── secure_storage_service.dart # 安全存储
│   ├── screens/
│   │   ├── home_screen.dart           # 主页
│   │   ├── config_screen.dart         # 配置页
│   │   └── log_screen.dart            # 日志页
│   └── widgets/
│       ├── connection_card.dart       # 连接卡片
│       └── status_indicator.dart      # 状态指示灯
├── android/
│   └── app/src/main/java/com/bitunnel/mobile/
│       ├── MainActivity.kt
│       ├── mux/
│       │   ├── MuxSession.kt          # Mux 协议实现
│       │   └── Socks5Proxy.kt         # SOCKS5 代理
│       └── service/
│           ├── TunnelService.kt       # 前台服务 + TLS
│           └── TunnelPlugin.kt        # Flutter 桥接
├── ios/
│   └── Runner/
│       ├── AppDelegate.swift
│       ├── BiTunnelPlugin.swift       # Flutter 桥接
│       ├── MuxSession.swift           # Mux 协议实现
│       └── TunnelService.swift        # 隧道 + 静默音频
├── pubspec.yaml
└── analysis_options.yaml
```

## Mux 协议格式

```
帧格式: [1B type][4B channelId][4B payloadLen][N payload]

type: 1=DATA, 2=CREATE, 3=CLOSE, 4=AUTH, 5=AUTH_RES, 6=CREATE_ACK
```

认证流程: AUTH(password+clientId) → AUTH_RES(1=ok)

加密: 密码非空时用 SHA256(password) 作为 AES-256-GCM 密钥
