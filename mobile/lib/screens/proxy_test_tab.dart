import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../services/secure_storage_service.dart';

class ProxyTestTab extends StatefulWidget {
  const ProxyTestTab({super.key});

  @override
  State<ProxyTestTab> createState() => _ProxyTestTabState();
}

class _TestCardState {
  final TextEditingController hostCtrl;
  final TextEditingController portCtrl;
  final TextEditingController userCtrl;
  final TextEditingController passCtrl;
  final TextEditingController targetCtrl;
  final TextEditingController proxyUrlCtrl;
  String proxyType;
  bool testing;
  bool cancelled;
  String result;
  Socket? testSocket;

  _TestCardState({
    String host = '',
    String port = '1080',
    String user = 'admin',
    String pass = 'admin',
    String target = 'http://www.bing.com',
    this.proxyType = 'SOCKS5',
  })  : hostCtrl = TextEditingController(text: host),
        portCtrl = TextEditingController(text: port),
        userCtrl = TextEditingController(text: user),
        passCtrl = TextEditingController(text: pass),
        targetCtrl = TextEditingController(text: target),
        proxyUrlCtrl = TextEditingController(),
        testing = false,
        cancelled = false,
        result = '';

  void dispose() {
    hostCtrl.dispose();
    portCtrl.dispose();
    userCtrl.dispose();
    passCtrl.dispose();
    targetCtrl.dispose();
    proxyUrlCtrl.dispose();
    testSocket?.destroy();
  }
}

class _ProxyTestTabState extends State<ProxyTestTab> {
  final List<_TestCardState> _cards = [];

  @override
  void initState() {
    super.initState();
    _addCard();
    _loadConfig();
  }

  void _addCard() {
    setState(() {
      _cards.add(_TestCardState());
    });
  }

  void _removeCard(int index) {
    setState(() {
      _cards[index].dispose();
      _cards.removeAt(index);
    });
  }

  Future<void> _loadConfig() async {
    final config = await SecureStorageService.loadConfig();
    if (!mounted) return;
    final firstProxy = config.proxies.isNotEmpty ? config.proxies.first : null;
    if (firstProxy != null && _cards.isNotEmpty) {
      _cards[0].hostCtrl.text = '127.0.0.1';
      _cards[0].portCtrl.text = firstProxy.listenPort.toString();
    }
  }

  @override
  void dispose() {
    for (final card in _cards) {
      card.dispose();
    }
    super.dispose();
  }

  void _onPortChanged(String value, TextEditingController ctrl) {
    final filtered = value.replaceAll(RegExp(r'[^0-9]'), '');
    final newPort = int.tryParse(filtered) ?? 0;
    final clamped = newPort.clamp(1, 65535);
    if (filtered != value || clamped != newPort) {
      ctrl.text = clamped.toString();
    }
  }

  void _parseProxyUrl(_TestCardState card, String url) {
    try {
      final uri = Uri.parse(url.trim());
      final scheme = uri.scheme;
      if (scheme == 'socks5' || scheme == 'socks5h') {
        card.proxyType = 'SOCKS5';
      } else if (scheme == 'http' || scheme == 'https') {
        card.proxyType = 'HTTP';
      } else {
        return;
      }
      card.hostCtrl.text = uri.host;
      card.portCtrl.text = uri.port.toString();
      if (uri.userInfo.isNotEmpty) {
        final parts = uri.userInfo.split(':');
        card.userCtrl.text = parts.isNotEmpty ? parts[0] : '';
        card.passCtrl.text = parts.length > 1 ? parts[1] : '';
      }
    } catch (_) {}
  }

  void _cancelTest(_TestCardState card) {
    card.cancelled = true;
    card.testSocket?.destroy();
    setState(() {
      card.testing = false;
      card.result = '已取消';
    });
  }

  Future<void> _testProxy(_TestCardState card) async {
    setState(() {
      card.testing = true;
      card.cancelled = false;
      card.result = '测试中...';
    });

    final host = card.hostCtrl.text.trim();
    final port = int.tryParse(card.portCtrl.text.trim()) ?? 0;
    final target = card.targetCtrl.text.trim();
    final username = card.userCtrl.text.trim();
    final password = card.passCtrl.text;

    if (host.isEmpty || port == 0) {
      setState(() {
        card.result = '请输入代理地址和端口';
        card.testing = false;
      });
      return;
    }

    try {
      final stopwatch = Stopwatch()..start();
      final socket = await Socket.connect(host, port, timeout: Duration(seconds: 5));
      card.testSocket = socket;
      stopwatch.reset();

      if (card.cancelled) {
        socket.destroy();
        return;
      }

      if (card.proxyType == 'SOCKS5') {
        await _testSocks5(card, socket, stopwatch, target, username, password);
      } else {
        await _testHttpConnect(card, socket, stopwatch, target, username, password);
      }
    } on SocketException catch (_) {
      if (!card.cancelled) {
        setState(() {
          card.result = '无法连接 $host:$port';
          card.testing = false;
        });
      }
    } catch (_) {
      if (!card.cancelled) {
        setState(() {
          card.result = '测试超时或错误';
          card.testing = false;
        });
      }
    } finally {
      card.testSocket = null;
    }
  }

  Future<void> _testSocks5(_TestCardState card, Socket socket, Stopwatch stopwatch, String target, String username, String password) async {
    socket.setOption(SocketOption.tcpNoDelay, true);

    final methodBuf = <int>[];
    final authBuf = <int>[];
    final connectBuf = <int>[];
    final responseBuf = <int>[];
    final methodDone = Completer<Uint8List>();
    final authDone = Completer<Uint8List>();
    final connectDone = Completer<Uint8List>();
    final responseDone = Completer<Uint8List>();

    StreamSubscription? sub;
    sub = socket.listen(
      (data) {
        if (!methodDone.isCompleted) {
          methodBuf.addAll(data);
          if (methodBuf.length >= 2) {
            methodDone.complete(Uint8List.fromList(methodBuf));
          }
        } else if (!authDone.isCompleted) {
          authBuf.addAll(data);
          if (authBuf.length >= 2) {
            authDone.complete(Uint8List.fromList(authBuf));
          }
        } else if (!connectDone.isCompleted) {
          connectBuf.addAll(data);
          if (connectBuf.length >= 10) {
            connectDone.complete(Uint8List.fromList(connectBuf));
          }
        } else if (!responseDone.isCompleted) {
          responseBuf.addAll(data);
          final str = utf8.decode(Uint8List.fromList(responseBuf), allowMalformed: true);
          if (str.contains('\r\n\r\n')) {
            responseDone.complete(Uint8List.fromList(responseBuf));
          }
        }
      },
      onDone: () {
        if (!methodDone.isCompleted) methodDone.complete(Uint8List.fromList(methodBuf));
        if (!authDone.isCompleted) authDone.complete(Uint8List.fromList(authBuf));
        if (!connectDone.isCompleted) connectDone.complete(Uint8List.fromList(connectBuf));
        if (!responseDone.isCompleted) responseDone.complete(Uint8List.fromList(responseBuf));
      },
      onError: (_) {
        if (!methodDone.isCompleted) methodDone.complete(Uint8List.fromList(methodBuf));
        if (!authDone.isCompleted) authDone.complete(Uint8List.fromList(authBuf));
        if (!connectDone.isCompleted) connectDone.complete(Uint8List.fromList(connectBuf));
        if (!responseDone.isCompleted) responseDone.complete(Uint8List.fromList(responseBuf));
      },
      cancelOnError: true,
    );

    try {
      // Step 1: Negotiate method
      socket.add([0x05, 0x02, 0x00, 0x02]);
      await socket.flush();
      final methodResp = await methodDone.future.timeout(Duration(seconds: 10));
      if (card.cancelled) return;
      if (methodResp[0] != 0x05) {
        _setResult(card, 'SOCKS5 版本错误 (ver=${methodResp[0]})');
        return;
      }
      final method = methodResp[1];
      if (method != 0x00 && method != 0x02) {
        _setResult(card, 'SOCKS5 不支持认证方法 (method=$method)');
        return;
      }

      // Step 2: Auth if needed
      if (method == 0x02) {
        final uBytes = utf8.encode(username);
        final pBytes = utf8.encode(password);
        socket.add(Uint8List.fromList([0x01, uBytes.length, ...uBytes, pBytes.length, ...pBytes]));
        await socket.flush();
        final authResp = await authDone.future.timeout(Duration(seconds: 10));
        if (card.cancelled) return;
        if (authResp[1] != 0x00) {
          _setResult(card, 'SOCKS5 认证失败 (status=${authResp[1]})');
          return;
        }
      }

      // Step 3: Send CONNECT request
      final domain = _extractHost(target);
      final domainBytes = utf8.encode(domain);
      final port = _extractPort(target);
      socket.add(Uint8List.fromList([0x05, 0x01, 0x00, 0x03, domainBytes.length, ...domainBytes, port >> 8, port & 0xFF]));
      await socket.flush();
      final connectResp = await connectDone.future.timeout(Duration(seconds: 10));
      if (card.cancelled) return;
      if (connectResp[1] != 0x00) {
        _setResult(card, 'SOCKS5 拒绝连接 (status=${connectResp[1]})');
        return;
      }

      // Step 4: Send HTTP request (or TLS upgrade + HTTP for HTTPS) and read response
      final isHttps = _extractPort(target) == 443;
      if (isHttps) {
        await sub!.cancel();
        final domain = _extractHost(target);
        final secureSocket = await SecureSocket.secure(socket, host: domain);
        final httpReq = 'GET / HTTP/1.0\r\nHost: $domain\r\nConnection: close\r\n\r\n';
        secureSocket.add(utf8.encode(httpReq));
        await secureSocket.flush();
        stopwatch.reset();
        final response = await _readHttpResponse(secureSocket, Duration(seconds: 15));
        if (card.cancelled) return;
        final elapsed = stopwatch.elapsedMilliseconds;
        final responseStr = utf8.decode(response, allowMalformed: true);
        if (responseStr.contains('HTTP/')) {
          _setResult(card, '代理正常 (${elapsed}ms, ${response.length} bytes)');
        } else {
          _setResult(card, '代理返回异常 (${elapsed}ms, ${response.length} bytes)');
        }
      } else {
        final httpReq = 'GET / HTTP/1.0\r\nHost: $target\r\nConnection: close\r\n\r\n';
        socket.add(utf8.encode(httpReq));
        await socket.flush();
        stopwatch.reset();
        final response = await responseDone.future.timeout(Duration(seconds: 15));
        if (card.cancelled) return;
        final elapsed = stopwatch.elapsedMilliseconds;
        final responseStr = utf8.decode(response, allowMalformed: true);
        if (responseStr.contains('HTTP/')) {
          _setResult(card, '代理正常 (${elapsed}ms, ${response.length} bytes)');
        } else {
          _setResult(card, '代理返回异常 (${elapsed}ms, ${response.length} bytes)');
        }
      }
    } on TimeoutException {
      _setResult(card, '连接超时');
    } catch (e) {
      if (!card.cancelled) {
        _setResult(card, '握手失败: $e');
      }
    } finally {
      await sub?.cancel();
      try { socket.destroy(); } catch (_) {}
    }
  }

  Future<Uint8List> _readHttpResponse(Socket socket, Duration timeout) {
    final buf = <int>[];
    final completer = Completer<Uint8List>();
    StreamSubscription? sub;
    sub = socket.listen(
      (data) {
        buf.addAll(data);
        final str = utf8.decode(Uint8List.fromList(buf), allowMalformed: true);
        if (str.contains('\r\n\r\n')) {
          sub?.cancel();
          if (!completer.isCompleted) completer.complete(Uint8List.fromList(buf));
        }
      },
      onDone: () {
        if (!completer.isCompleted) completer.complete(Uint8List.fromList(buf));
      },
      onError: (_) {
        if (!completer.isCompleted) completer.complete(Uint8List.fromList(buf));
      },
      cancelOnError: true,
    );
    return completer.future.timeout(timeout).whenComplete(() => sub?.cancel());
  }

  void _setResult(_TestCardState card, String result) {
    if (!card.cancelled && card.testing) {
      setState(() {
        card.result = result;
        card.testing = false;
      });
    }
  }

  Future<void> _testHttpConnect(_TestCardState card, Socket socket, Stopwatch stopwatch, String target, String username, String password) async {
    final host = _extractHost(target);
    final port = _extractPort(target);
    final authHeader = username.isNotEmpty
        ? 'Proxy-Authorization: Basic ${base64Encode(utf8.encode('$username:$password'))}\r\n'
        : '';
    final connectReq = 'CONNECT $host:$port HTTP/1.1\r\nHost: $host:$port\r\n${authHeader}\r\n';
    socket.add(utf8.encode(connectReq));
    await socket.flush();

    final buffer = <int>[];
    final completer = Completer<String>();
    final sub = socket.listen(
      (data) {
        if (card.cancelled) {
          completer.complete('已取消');
          return;
        }
        buffer.addAll(data);
        final responseStr = utf8.decode(Uint8List.fromList(buffer));
        if (responseStr.contains('\r\n\r\n')) {
              final elapsed = stopwatch.elapsedMilliseconds;
              if (responseStr.contains('200')) {
                completer.complete('HTTP CONNECT 成功 (${elapsed}ms)');
              } else if (responseStr.contains('407')) {
                completer.complete('HTTP CONNECT 认证失败 (407)');
              } else {
                completer.complete('HTTP CONNECT 失败: ${responseStr.split('\r\n').first}');
              }
        }
      },
      onDone: () {
        if (!completer.isCompleted) {
          completer.complete('连接已关闭 (${buffer.length} bytes)');
        }
      },
      onError: (e) {
        if (!completer.isCompleted) completer.complete('连接错误');
      },
      cancelOnError: false,
    );

    final result = await completer.future.timeout(Duration(seconds: 15));
    await sub.cancel();
    socket.destroy();

    if (!card.cancelled) {
      setState(() {
        card.result = result;
        card.testing = false;
      });
    }
  }

  String _extractHost(String url) {
    try {
      final uri = Uri.parse(url);
      return uri.host;
    } catch (_) {
      return url;
    }
  }

  int _extractPort(String url) {
    try {
      final uri = Uri.parse(url);
      return uri.port;
    } catch (_) {
      return 80;
    }
  }

  Widget _buildTestCard(int index) {
    final card = _cards[index];
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.language_rounded, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('代理测试 #${index + 1}', style: theme.textTheme.titleSmall),
                const Spacer(),
                IconButton(
                  icon: Icon(Icons.delete_outline, color: theme.colorScheme.error, size: 20),
                  onPressed: () => _removeCard(index),
                  constraints: const BoxConstraints(),
                  padding: EdgeInsets.zero,
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: card.proxyUrlCtrl,
              decoration: const InputDecoration(
                labelText: '代理 URL（可选）',
                hintText: 'socks5://user:pass@host:port',
                prefixIcon: Icon(Icons.link_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: (v) => _parseProxyUrl(card, v),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: card.hostCtrl,
                    decoration: const InputDecoration(
                      labelText: '代理地址',
                      hintText: '127.0.0.1',
                      prefixIcon: Icon(Icons.dns_rounded),
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: SizedBox(
                    width: 100,
                    child: TextField(
                      controller: card.portCtrl,
                      keyboardType: TextInputType.number,
                      onChanged: (v) => _onPortChanged(v, card.portCtrl),
                      decoration: const InputDecoration(
                        labelText: '端口',
                        hintText: '1080',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: card.proxyType,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '代理类型',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'SOCKS5', child: Text('SOCKS5')),
                      DropdownMenuItem(value: 'HTTP', child: Text('HTTP CONNECT')),
                    ],
                    onChanged: (v) {
                      if (v != null) setState(() => card.proxyType = v);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: card.targetCtrl,
                    decoration: const InputDecoration(
                      labelText: '目标 URL',
                      hintText: 'https://www.bing.com',
                      prefixIcon: Icon(Icons.open_in_new_rounded),
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: card.userCtrl,
                    decoration: const InputDecoration(
                      labelText: '用户名',
                      hintText: 'admin',
                      prefixIcon: Icon(Icons.person_rounded),
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: card.passCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: '密码',
                      hintText: 'admin',
                      prefixIcon: Icon(Icons.lock_rounded),
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: card.testing ? null : () => _testProxy(card),
                    icon: card.testing
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.play_arrow_rounded),
                    label: Text(card.testing ? '测试中...' : '测试代理'),
                  ),
                ),
                if (card.testing) ...[
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () => _cancelTest(card),
                    icon: const Icon(Icons.stop_rounded),
                    label: const Text('取消'),
                  ),
                ],
              ],
            ),
            if (card.result.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: (card.result.contains('正常') || card.result.contains('成功'))
                      ? Colors.green.withValues(alpha: 0.1)
                      : Colors.red.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  card.result,
                  style: TextStyle(
                    fontSize: 13,
                    color: (card.result.contains('正常') || card.result.contains('成功'))
                        ? Colors.green
                        : Colors.red,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Icon(Icons.language_rounded, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('代理测试 (${_cards.length})', style: theme.textTheme.titleMedium),
            const Spacer(),
            TextButton.icon(
              onPressed: _addCard,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('添加测试'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_cards.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text('暂无测试，点击"添加测试"创建', style: TextStyle(color: Colors.grey.shade500)),
              ),
            ),
          )
        else
          ..._cards.asMap().entries.map((e) => _buildTestCard(e.key)),
      ],
    );
  }
}
