import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:pointycastle/export.dart' hide State, Padding, Random;
import '../services/secure_storage_service.dart';

class ProxyTestTab extends StatefulWidget {
  const ProxyTestTab({super.key});

  @override
  State<ProxyTestTab> createState() => _ProxyTestTabState();
}

class _ProxyTestTabState extends State<ProxyTestTab> {
  bool _testingConnectivity = false;
  bool _testingAuth = false;
  bool _testingProxy = false;

  String _connectivityResult = '';
  String _authResult = '';
  String _proxyResult = '';

  final _connHostCtrl = TextEditingController();
  final _connPortCtrl = TextEditingController(text: '33891');

  final _authPassCtrl = TextEditingController();
  final _authClientIdCtrl = TextEditingController(text: 'mobile-1');
  final _authHostCtrl = TextEditingController();
  final _authPortCtrl = TextEditingController(text: '33891');

  final _proxyPortCtrl = TextEditingController(text: '1080');

  final _secureRand = Random.secure();

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final config = await SecureStorageService.loadConfig();
    if (!mounted) return;
    final firstClient = config.clients.isNotEmpty ? config.clients.first : null;
    _connHostCtrl.text = firstClient?.serverHost ?? '';
    _connPortCtrl.text = (firstClient?.serverPort ?? 33891).toString();
    _authHostCtrl.text = firstClient?.serverHost ?? '';
    _authPortCtrl.text = (firstClient?.serverPort ?? 33891).toString();
    _authPassCtrl.text = firstClient?.password ?? '';
    _authClientIdCtrl.text = firstClient?.clientId ?? 'mobile-1';
    _proxyPortCtrl.text = (1080).toString();
  }

  @override
  void dispose() {
    _connHostCtrl.dispose();
    _connPortCtrl.dispose();
    _authPassCtrl.dispose();
    _authClientIdCtrl.dispose();
    _authHostCtrl.dispose();
    _authPortCtrl.dispose();
    _proxyPortCtrl.dispose();
    super.dispose();
  }

  Future<void> _testConnectivity() async {
    setState(() {
      _testingConnectivity = true;
      _connectivityResult = '测试中...';
    });

    final host = _connHostCtrl.text.trim();
    final port = int.tryParse(_connPortCtrl.text.trim()) ?? 33891;

    if (host.isEmpty) {
      setState(() {
        _connectivityResult = '请输入服务器地址';
        _testingConnectivity = false;
      });
      return;
    }

    try {
      final stopwatch = Stopwatch()..start();
      final socket = await Socket.connect(host, port, timeout: Duration(seconds: 10));
      final tcpTime = stopwatch.elapsedMilliseconds;
      socket.destroy();

      String tlsResult = '';
      try {
        stopwatch.reset();
        final tlsSocket = await SecureSocket.connect(
          host, port,
          timeout: Duration(seconds: 10),
        );
        final tlsTime = stopwatch.elapsedMilliseconds;
        tlsSocket.destroy();
        tlsResult = 'TLS 握手成功 (${tlsTime}ms)';
      } catch (e) {
        tlsResult = 'TLS 握手失败';
      }

      setState(() {
        _connectivityResult = 'TCP 连接成功 (${tcpTime}ms)\n$tlsResult';
        _testingConnectivity = false;
      });
    } catch (e) {
      setState(() {
        _connectivityResult = '连接失败';
        _testingConnectivity = false;
      });
    }
  }

  Future<void> _testAuth() async {
    setState(() {
      _testingAuth = true;
      _authResult = '测试中...';
    });

    final host = _authHostCtrl.text.trim();
    final port = int.tryParse(_authPortCtrl.text.trim()) ?? 33891;
    final password = _authPassCtrl.text;
    final clientId = _authClientIdCtrl.text.trim();

    if (host.isEmpty) {
      setState(() {
        _authResult = '请输入服务器地址';
        _testingAuth = false;
      });
      return;
    }

    try {
      final stopwatch = Stopwatch()..start();
      final tlsSocket = await SecureSocket.connect(
        host, port,
        timeout: Duration(seconds: 10),
      );
      stopwatch.reset();

      final authPayload = jsonEncode({'password': password, 'clientId': clientId});
      final encrypted = _encryptPayload(password, authPayload);

      final header = ByteData(9);
      header.setUint8(0, 4);
      header.setInt32(1, 0, Endian.big);
      header.setInt32(5, encrypted.length, Endian.big);

      tlsSocket.add(header.buffer.asUint8List());
      tlsSocket.add(encrypted);
      await tlsSocket.flush();

      final completer = Completer<Uint8List>();
      final chunks = <int>[];
      tlsSocket.listen(
        (data) => chunks.addAll(data),
        onDone: () => completer.complete(Uint8List.fromList(chunks)),
        onError: (e) {
          if (!completer.isCompleted) completer.complete(Uint8List.fromList(chunks));
        },
        cancelOnError: false,
      );

      final response = await completer.future.timeout(Duration(seconds: 15));
      tlsSocket.destroy();

      final elapsed = stopwatch.elapsedMilliseconds;

      if (response.length < 9) {
        setState(() {
          _authResult = '响应不完整 (${response.length} bytes)';
          _testingAuth = false;
        });
        return;
      }

      final respType = response[0];
      final byteData = ByteData.sublistView(response, 5, 9);
      final respPayloadLen = byteData.getInt32(0, Endian.big);

      if (response.length < 9 + respPayloadLen) {
        setState(() {
          _authResult = '响应数据不完整 (need ${9 + respPayloadLen}, got ${response.length})';
          _testingAuth = false;
        });
        return;
      }

      final rawPayload = response.sublist(9, 9 + respPayloadLen);
      final decrypted = _decryptPayload(password, Uint8List.fromList(rawPayload));
      final authenticated = decrypted.isNotEmpty && decrypted[0] == 1;

      setState(() {
        _authResult = authenticated
            ? '认证成功 (${elapsed}ms)'
            : '认证失败 (${elapsed}ms)';
        _testingAuth = false;
      });
    } catch (e) {
      setState(() {
        _authResult = '错误';
        _testingAuth = false;
      });
    }
  }

  Uint8List _encryptPayload(String password, String plaintext) {
    final key = _sha256(password);
    final iv = Uint8List(12);
    for (var i = 0; i < 12; i++) {
      iv[i] = _secureRand.nextInt(256);
    }
    final cipher = GCMBlockCipher(AESEngine())
      ..init(true, ParametersWithIV(KeyParameter(key), iv));
    final pt = Uint8List.fromList(utf8.encode(plaintext));
    final out = Uint8List(cipher.getOutputSize(pt.length));
    final len = cipher.processBytes(pt, 0, pt.length, out, 0);
    cipher.doFinal(out, len);
    return Uint8List.fromList([...iv, ...out]);
  }

  Uint8List _decryptPayload(String plainPassword, Uint8List data) {
    if (data.isEmpty) return data;
    final key = _sha256(plainPassword);
    if (data.length < 28) return data;
    final iv = data.sublist(0, 12);
    final cipher = GCMBlockCipher(AESEngine())
      ..init(false, ParametersWithIV(KeyParameter(key), iv));
    final ct = data.sublist(12);
    final out = Uint8List(cipher.getOutputSize(ct.length));
    final len = cipher.processBytes(ct, 0, ct.length, out, 0);
    cipher.doFinal(out, len);
    return out;
  }

  Uint8List _sha256(String input) {
    final digest = SHA256Digest();
    return digest.process(Uint8List.fromList(utf8.encode(input)));
  }

  Future<void> _testProxy() async {
    setState(() {
      _testingProxy = true;
      _proxyResult = '测试中...';
    });

    final proxyPort = int.tryParse(_proxyPortCtrl.text.trim()) ?? 1080;

    try {
      final stopwatch = Stopwatch()..start();
      final socket = await Socket.connect('127.0.0.1', proxyPort, timeout: Duration(seconds: 5));
      stopwatch.reset();

      final buffer = <int>[];
      final completer = Completer<String>();
      int step = 0;

      StreamSubscription<List<int>> sub;
      sub = socket.listen(
        (data) {
          buffer.addAll(data);
          if (step == 0 && buffer.length >= 2) {
            final ver = buffer[0];
            final method = buffer[1];
            if (ver != 0x05 || method != 0x00) {
              completer.complete('SOCKS5 握手失败 (ver=$ver, method=$method)');
              return;
            }
            buffer.clear();
            step = 1;
            final domain = 'example.com';
            final domainBytes = utf8.encode(domain);
            final req = Uint8List.fromList([
              0x05, 0x01, 0x00, 0x03,
              domainBytes.length,
              ...domainBytes,
              0x00, 0x50,
            ]);
            socket.add(req);
            socket.flush();
          } else if (step == 1 && buffer.length >= 10) {
            final respVer = buffer[0];
            final respStatus = buffer[1];
            if (respVer != 0x05 || respStatus != 0x00) {
              completer.complete('SOCKS5 拒绝连接 (status=$respStatus)');
              return;
            }
            buffer.clear();
            step = 2;
            final httpReq = 'GET / HTTP/1.0\r\nHost: example.com\r\nConnection: close\r\n\r\n';
            socket.add(utf8.encode(httpReq));
            socket.flush();
          }
        },
        onDone: () {
          final elapsed = stopwatch.elapsedMilliseconds;
          final responseStr = utf8.decode(Uint8List.fromList(buffer));
          if (responseStr.contains('HTTP/')) {
            completer.complete('代理正常 (${elapsed}ms, ${buffer.length} bytes)');
          } else {
            completer.complete('代理返回异常 (${elapsed}ms, ${buffer.length} bytes)');
          }
        },
        onError: (e) {
          if (!completer.isCompleted) {
            completer.complete('连接错误');
          }
        },
        cancelOnError: false,
      );

      socket.add([0x05, 0x01, 0x00]);
      await socket.flush();

      final result = await completer.future.timeout(Duration(seconds: 15));
      await sub.cancel();
      socket.destroy();

      setState(() {
        _proxyResult = result;
        _testingProxy = false;
      });
    } on SocketException catch (e) {
      setState(() {
        _proxyResult = '无法连接代理 127.0.0.1:$proxyPort';
        _testingProxy = false;
      });
    } catch (e) {
      setState(() {
        _proxyResult = '测试超时或错误';
        _testingProxy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildConnectivityCard(theme),
        const SizedBox(height: 12),
        _buildAuthCard(theme),
        const SizedBox(height: 12),
        _buildProxyCard(theme),
      ],
    );
  }

  Widget _buildConnectivityCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.wifi_tethering_rounded, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('服务器连通性测试', style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _connHostCtrl,
              decoration: const InputDecoration(
                labelText: '服务器地址',
                hintText: 'example.com',
                prefixIcon: Icon(Icons.dns_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _connPortCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: '端口',
                hintText: '33891',
                prefixIcon: Icon(Icons.numbers_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _testingConnectivity ? null : _testConnectivity,
                icon: _testingConnectivity
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.play_arrow_rounded),
                label: Text(_testingConnectivity ? '测试中...' : '测试连接'),
              ),
            ),
            if (_connectivityResult.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _connectivityResult.contains('成功')
                      ? Colors.green.withValues(alpha: 0.1)
                      : Colors.red.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _connectivityResult,
                  style: TextStyle(
                    fontSize: 13,
                    color: _connectivityResult.contains('成功') ? Colors.green : Colors.red,
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

  Widget _buildAuthCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_user_rounded, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('认证测试', style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _authHostCtrl,
              decoration: const InputDecoration(
                labelText: '服务器地址',
                hintText: 'example.com',
                prefixIcon: Icon(Icons.dns_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _authPortCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: '端口',
                hintText: '33891',
                prefixIcon: Icon(Icons.numbers_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _authPassCtrl,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '连接密码',
                prefixIcon: Icon(Icons.lock_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _authClientIdCtrl,
              decoration: const InputDecoration(
                labelText: '客户端 ID',
                hintText: 'mobile-1',
                prefixIcon: Icon(Icons.badge_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _testingAuth ? null : _testAuth,
                icon: _testingAuth
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.play_arrow_rounded),
                label: Text(_testingAuth ? '测试中...' : '测试认证'),
              ),
            ),
            if (_authResult.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _authResult.contains('成功')
                      ? Colors.green.withValues(alpha: 0.1)
                      : Colors.red.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _authResult,
                  style: TextStyle(
                    fontSize: 13,
                    color: _authResult.contains('成功') ? Colors.green : Colors.red,
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

  Widget _buildProxyCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.language_rounded, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('代理功能测试', style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _proxyPortCtrl,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: '本地代理端口',
                hintText: '1080',
                prefixIcon: Icon(Icons.lan_rounded),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _testingProxy ? null : _testProxy,
                icon: _testingProxy
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.play_arrow_rounded),
                label: Text(_testingProxy ? '测试中...' : '测试代理'),
              ),
            ),
            if (_proxyResult.isNotEmpty) ...[
              const SizedBox(height: 8),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: _proxyResult.contains('正常')
                      ? Colors.green.withValues(alpha: 0.1)
                      : Colors.red.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _proxyResult,
                  style: TextStyle(
                    fontSize: 13,
                    color: _proxyResult.contains('正常') ? Colors.green : Colors.red,
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
}
