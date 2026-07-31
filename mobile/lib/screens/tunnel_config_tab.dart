import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import '../models/connection_config.dart';
import '../services/platform_service.dart';

class TunnelConfigTab extends StatefulWidget {
  final AppConfig config;
  final void Function(AppConfig) onSave;

  const TunnelConfigTab({
    super.key,
    required this.config,
    required this.onSave,
  });

  @override
  State<TunnelConfigTab> createState() => _TunnelConfigTabState();
}

class _TunnelConfigTabState extends State<TunnelConfigTab> {
  late List<TunnelServerConfig> _servers;
  late List<TunnelClientConfig> _clients;
  final Map<String, TextEditingController> _ctrls = {};
  StreamSubscription<Map<String, dynamic>>? _statusSub;
  Map<String, String> _clientStatuses = {};
  Map<String, List<String>> _serverClients = {};
  final Set<String> _visiblePasswords = {};
  List<String> _availableIps = ['0.0.0.0', '127.0.0.1'];

  Future<void> _loadNetworkIps() async {
    try {
      final ips = <String>['0.0.0.0', '127.0.0.1'];
      final interfaces = await NetworkInterface.list();
      for (final iface in interfaces) {
        for (final addr in iface.addresses) {
          if (addr.type == InternetAddressType.IPv4) {
            final ip = addr.address;
            if (!ips.contains(ip)) ips.add(ip);
          }
        }
      }
      if (mounted) setState(() => _availableIps = ips);
    } catch (_) {}
  }

  TextEditingController _getCtrl(String key, String initialText) {
    if (!_ctrls.containsKey(key)) {
      _ctrls[key] = TextEditingController(text: initialText);
    }
    return _ctrls[key]!;
  }

  void _syncCtrl(String key, String newValue) {
    if (_ctrls[key]?.text != newValue) {
      _ctrls[key]?.text = newValue;
    }
  }

  void _onPortChanged(String value, TextEditingController ctrl, void Function(int) onSet) {
    final filtered = value.replaceAll(RegExp(r'[^0-9]'), '');
    final newPort = int.tryParse(filtered) ?? 0;
    final clamped = newPort.clamp(1, 65535);
    if (filtered != value || clamped != newPort) {
      ctrl.text = clamped.toString();
    }
    onSet(clamped);
  }

  String _validateUsername(String v) {
    final trimmed = v.trim();
    if (trimmed.isEmpty && v.isNotEmpty) return '';
    return trimmed;
  }

  String _validatePassword(String v) {
    if (v.trim().isEmpty) return '';
    return v;
  }

  @override
  void initState() {
    super.initState();
    _servers = List.from(widget.config.servers);
    _clients = List.from(widget.config.clients);
    _statusSub = PlatformService.statusStream.listen(_onStatus);
    _syncInitialStatus();
    _loadNetworkIps();
  }

  Future<void> _syncInitialStatus() async {
    try {
      final status = await PlatformService.getStatus();
      if (mounted) _onStatus(status);
    } catch (e) {
      debugPrint('syncInitialStatus error: $e');
    }
  }

  void _onStatus(Map<String, dynamic> status) {
    try {
      final instances = (status['instances'] as List?) ?? [];
      debugPrint('onStatus: ${instances.length} instances');
      final cStatuses = <String, String>{};
      final sClients = <String, List<String>>{};
      for (final inst in instances) {
        final instMap = Map<String, dynamic>.from(inst as Map);
        final id = instMap['id'] as String? ?? '';
        final type = instMap['type'] as String? ?? '';
        final isRunning = instMap['running'] as bool? ?? false;
        debugPrint('onStatus: id=$id type=$type running=$isRunning');
        if (type == 'client') {
          final s = instMap['status'] as String? ?? 'disconnected';
          cStatuses[id] = s;
          final ci = _clients.indexWhere((c) => c.id == id);
          if (ci >= 0) {
            _clients[ci] = _clients[ci].copyWith(running: s == 'connected' || s == 'connecting' || s == 'reconnecting');
          }
        } else if (type == 'server') {
          final clients = instMap['connectedClients'] as List? ?? [];
          sClients[id] = List<String>.from(clients);
          final si = _servers.indexWhere((s) => s.id == id);
          if (si >= 0) {
            _servers[si] = _servers[si].copyWith(running: isRunning);
          }
        }
      }
      if (mounted) {
        setState(() {
          _clientStatuses = cStatuses;
          _serverClients = sClients;
        });
      }
    } catch (e) {
      debugPrint('onStatus error: $e');
    }
  }

  @override
  void didUpdateWidget(covariant TunnelConfigTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 注意：不重置 _servers/_clients —— 本地状态是唯一数据源，
    // widget.config 只会由本 tab 的 _autoSave 更新，重置会丢用户编辑
    for (final s in _servers) {
      _syncCtrl('server_${s.id}_name', s.name);
      _syncCtrl('server_${s.id}_bindIp', s.bindIp);
      _syncCtrl('server_${s.id}_listenPort', s.listenPort.toString());
      _syncCtrl('server_${s.id}_password', s.password);
      _syncCtrl('server_${s.id}_sni', s.sni);
      for (final pf in s.portForwards) {
        _syncCtrl('server_${s.id}_pf_${pf.id}_listenPort', pf.listenPort.toString());
        _syncCtrl('server_${s.id}_pf_${pf.id}_targetHost', pf.targetHost);
        _syncCtrl('server_${s.id}_pf_${pf.id}_targetPort', pf.targetPort.toString());
      }
    }
    for (final c in _clients) {
      _syncCtrl('client_${c.id}_name', c.name);
      _syncCtrl('client_${c.id}_serverHost', c.serverHost);
      _syncCtrl('client_${c.id}_serverPort', c.serverPort.toString());
      _syncCtrl('client_${c.id}_password', c.password);
      _syncCtrl('client_${c.id}_sni', c.sni);
      _syncCtrl('client_${c.id}_clientId', c.clientId);
    }
    _syncInitialStatus();
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _autoSave() {
    final cfg = widget.config.copyWith(servers: _servers, clients: _clients);
    widget.onSave(cfg);
  }

  void _addClient() {
    setState(() {
      _clients.add(TunnelClientConfig(
        name: '客户端 ${_clients.length + 1}',
        clientId: 'mobile-${_clients.length + 1}',
      ));
    });
    _autoSave();
  }

  void _removeClient(int index) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除客户端'),
        content: Text('确定删除"${_clients[index].name}"吗？'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('删除')),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() {
      _clients.removeAt(index);
    });
    _autoSave();
  }

  void _removeServer(int index) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除服务端'),
        content: Text('确定删除"${_servers[index].name}"吗？'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('删除')),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() {
      _servers.removeAt(index);
    });
    _autoSave();
  }

  Widget _buildServerStatus(bool running, int connectedCount) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10, height: 10,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: running ? Colors.green : Colors.grey,
            boxShadow: running
                ? [BoxShadow(color: Colors.green.withValues(alpha: 0.5), blurRadius: 6)]
                : null,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          running ? '运行中' : '已停止',
          style: TextStyle(
            color: running ? Colors.green : Colors.grey,
            fontSize: 12, fontWeight: FontWeight.w600,
          ),
        ),
        if (running && connectedCount > 0) ...[
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: Colors.green.shade50,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              '$connectedCount 在线',
              style: TextStyle(color: Colors.green.shade700, fontSize: 10, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildClientStatus(String status) {
    Color color;
    String label;
    switch (status) {
      case 'connected':
        color = Colors.green;
        label = '已连接';
      case 'connecting':
        color = Colors.orange;
        label = '连接中';
      case 'reconnecting':
        color = Colors.amber;
        label = '重连中';
      case 'failed':
        color = Colors.red;
        label = '连接失败';
      default:
        color = Colors.grey;
        label = '已停止';
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10, height: 10,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color,
            boxShadow: [BoxShadow(color: color.withValues(alpha: 0.5), blurRadius: 6)],
          ),
        ),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _buildPfRuleList(
    List<PortForwardRule> rules,
    String prefix,
    List<TunnelClientConfig> clients,
    void Function(List<PortForwardRule>) onUpdate, {
    bool running = false,
    String instanceId = '',
  }) {
    return ExpansionTile(
      title: Text('端口转发规则 (${rules.length})', style: const TextStyle(fontSize: 13)),
      initiallyExpanded: false,
      children: [
        ...rules.asMap().entries.map((e) {
          final i = e.key;
          final rule = e.value;
          return Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            child: Card(
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Switch(
                          value: rule.enabled,
                          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          onChanged: (v) async {
                            if (running) {
                              if (v) {
                                await PlatformService.startPortForward(instanceId, rule.toJson());
                              } else {
                                await PlatformService.stopPortForward(instanceId, rule.id);
                              }
                            }
                            final updated = List<PortForwardRule>.from(rules);
                            updated[i] = rule.copyWith(enabled: v);
                            onUpdate(updated);
                          },
                        ),
                        const Spacer(),
                        IconButton(
                          icon: Icon(Icons.delete_outline, color: Colors.red.shade400, size: 18),
                          onPressed: () async {
                            final confirm = await showDialog<bool>(
                              context: context,
                              builder: (ctx) => AlertDialog(
                                title: const Text('删除转发规则'),
                                content: Text('确定删除监听 ${rule.listenPort} 的转发规则吗？'),
                                actions: [
                                  TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
                                  TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('删除')),
                                ],
                              ),
                            );
                            if (confirm != true) return;
                            final updated = List<PortForwardRule>.from(rules);
                            updated.removeAt(i);
                            onUpdate(updated);
                          },
                          constraints: const BoxConstraints(),
                          padding: EdgeInsets.zero,
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _getCtrl('${prefix}_pf_${rule.id}_listenPort', rule.listenPort.toString()),
                            onChanged: (v) {
                              _onPortChanged(v, _getCtrl('${prefix}_pf_${rule.id}_listenPort', ''), (newPort) {
                                final updated = List<PortForwardRule>.from(rules);
                                updated[i] = rule.copyWith(listenPort: newPort);
                                onUpdate(updated);
                              });
                            },
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: '监听端口',
                              border: OutlineInputBorder(),
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                            ),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: TextField(
                            controller: _getCtrl('${prefix}_pf_${rule.id}_targetHost', rule.targetHost),
                            onChanged: (v) {
                              final updated = List<PortForwardRule>.from(rules);
                              updated[i] = rule.copyWith(targetHost: v);
                              onUpdate(updated);
                            },
                            decoration: const InputDecoration(
                              labelText: '目标地址',
                              border: OutlineInputBorder(),
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                            ),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                        const SizedBox(width: 4),
                        SizedBox(
                          width: 70,
                          child: TextField(
                            controller: _getCtrl('${prefix}_pf_${rule.id}_targetPort', rule.targetPort.toString()),
                            onChanged: (v) {
                              _onPortChanged(v, _getCtrl('${prefix}_pf_${rule.id}_targetPort', ''), (newPort) {
                                final updated = List<PortForwardRule>.from(rules);
                                updated[i] = rule.copyWith(targetPort: newPort);
                                onUpdate(updated);
                              });
                            },
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: '目标端口',
                              border: OutlineInputBorder(),
                              isDense: true,
                              contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                            ),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      ],
                    ),
                    if (prefix.startsWith('server_'))
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: DropdownButtonFormField<String>(
                          value: rule.targetClientId,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: '目标客户端',
                            border: OutlineInputBorder(),
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                          ),
                          items: [
                            const DropdownMenuItem<String>(
                              value: null,
                              child: Text('（当前隧道）', style: TextStyle(fontSize: 12)),
                            ),
                            ...clients.map((c) => DropdownMenuItem<String>(
                                  value: c.clientId,
                                  child: Text('${c.name} (${c.clientId})', style: const TextStyle(fontSize: 12)),
                                )),
                          ],
                          onChanged: (v) {
                            final updated = List<PortForwardRule>.from(rules);
                            updated[i] = rule.copyWith(targetClientId: v);
                            onUpdate(updated);
                          },
                        ),
                      ),
                  ],
                ),
              ),
            ),
          );
        }),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: TextButton.icon(
            onPressed: () {
              final updated = List<PortForwardRule>.from(rules)
                ..add(PortForwardRule());
              onUpdate(updated);
            },
            icon: const Icon(Icons.add, size: 16),
            label: const Text('添加转发规则', style: TextStyle(fontSize: 12)),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ),
        ),
      ],
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
            Icon(Icons.dns_rounded, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('服务端 (${_servers.length})', style: theme.textTheme.titleMedium),
            const Spacer(),
            TextButton.icon(
              onPressed: () {
                setState(() {
                  _servers.add(TunnelServerConfig(name: '服务端 ${_servers.length + 1}'));
                });
              },
              icon: const Icon(Icons.add, size: 18),
              label: const Text('添加服务端'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_servers.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Center(
                child: Text('暂无服务端配置', style: TextStyle(color: Colors.grey.shade500)),
              ),
            ),
          )
        else
          ..._servers.asMap().entries.map((e) => _buildServerCard(e.key, theme)),
        const Divider(height: 32),
        Row(
          children: [
            Icon(Icons.devices_rounded, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('客户端 (${_clients.length})', style: theme.textTheme.titleMedium),
            const Spacer(),
            TextButton.icon(
              onPressed: _addClient,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('添加客户端'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_clients.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text('暂无客户端，点击"添加客户端"创建', style: TextStyle(color: Colors.grey.shade500)),
              ),
            ),
          )
        else
          ..._clients.asMap().entries.map((e) => _buildClientCard(e.key, theme)),
        const Divider(height: 32),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.battery_charging_full_rounded, size: 18, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Text('后台保活', style: theme.textTheme.titleSmall),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'ColorOS 默认禁止非商店应用通知，需要手动开启：',
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () => PlatformService.openNotificationSettings(),
                    icon: const Icon(Icons.notifications_rounded, size: 18),
                    label: const Text('打开通知设置 → 允许通知'),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () => PlatformService.openAppSettings(),
                    icon: const Icon(Icons.battery_charging_full_rounded, size: 18),
                    label: const Text('打开应用设置 → 耗电保护'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildServerCard(int index, ThemeData theme) {
    final server = _servers[index];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.dns_rounded, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _getCtrl('server_${server.id}_name', server.name),
                    onChanged: (v) {
                      setState(() {
                        _servers[index] = server.copyWith(name: v);
                      });
                      _autoSave();
                    },
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                  ),
                ),
                const SizedBox(width: 8),
                _buildServerStatus(server.running, _serverClients[server.id]?.length ?? 0),
                IconButton(
                  icon: Icon(Icons.delete_outline, color: theme.colorScheme.error, size: 20),
                  onPressed: () => _removeServer(index),
                  constraints: const BoxConstraints(),
                  padding: EdgeInsets.zero,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _availableIps.contains(server.bindIp) ? server.bindIp : null,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '绑定IP',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    items: _availableIps.map((ip) => DropdownMenuItem(
                      value: ip,
                      child: Text(ip, style: const TextStyle(fontSize: 13)),
                    )).toList(),
                    onChanged: (v) {
                      if (v == null) return;
                      setState(() {
                        _servers[index] = server.copyWith(bindIp: v);
                      });
                      _autoSave();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _getCtrl('server_${server.id}_listenPort', server.listenPort.toString()),
                    onChanged: (v) {
                      _onPortChanged(v, _getCtrl('server_${server.id}_listenPort', ''), (newPort) {
                        final conflict = _servers.asMap().entries.any((e) =>
                          e.key != index && e.value.listenPort == newPort);
                        if (conflict) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('端口已被其他服务端使用'), duration: Duration(seconds: 2)),
                          );
                        }
                        setState(() {
                          _servers[index] = server.copyWith(listenPort: newPort);
                        });
                        _autoSave();
                      });
                    },
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: '监听端口',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _getCtrl('server_${server.id}_password', server.password),
                    onChanged: (v) {
                      final pw = _validatePassword(v);
                      if (pw != v) {
                        _getCtrl('server_${server.id}_password', '').text = pw;
                      }
                      setState(() {
                        _servers[index] = server.copyWith(password: pw);
                      });
                      _autoSave();
                    },
                    obscureText: !_visiblePasswords.contains('server_${server.id}_password'),
                    decoration: InputDecoration(
                      labelText: '密码',
                      border: const OutlineInputBorder(),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _visiblePasswords.contains('server_${server.id}_password')
                              ? Icons.visibility_off
                              : Icons.visibility,
                          size: 18,
                        ),
                        onPressed: () {
                          setState(() {
                            if (_visiblePasswords.contains('server_${server.id}_password')) {
                              _visiblePasswords.remove('server_${server.id}_password');
                            } else {
                              _visiblePasswords.add('server_${server.id}_password');
                            }
                          });
                        },
                        constraints: const BoxConstraints(),
                        padding: EdgeInsets.zero,
                      ),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _getCtrl('server_${server.id}_sni', server.sni),
                    onChanged: (v) {
                      setState(() {
                        _servers[index] = server.copyWith(sni: v);
                      });
                      _autoSave();
                    },
                    decoration: const InputDecoration(
                      labelText: 'SNI',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              ],
            ),
            _buildPfRuleList(
              server.portForwards,
              'server_${server.id}',
              _clients,
              (updated) {
                setState(() {
                  _servers[index] = server.copyWith(portForwards: updated);
                });
                _autoSave();
              },
              running: server.running,
              instanceId: server.id,
            ),
            if (server.running) ...[
              const SizedBox(height: 8),
              ExpansionTile(
                title: Text('已连接客户端 (${_serverClients[server.id]?.length ?? 0})', style: const TextStyle(fontSize: 13)),
                initiallyExpanded: false,
                children: [
                  if ((_serverClients[server.id]?.length ?? 0) == 0)
                    Padding(
                      padding: const EdgeInsets.all(8),
                      child: Text('暂无客户端连接', style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
                    )
                  else
                    ...(_serverClients[server.id] ?? []).map((clientId) => ListTile(
                          dense: true,
                          leading: Container(
                            width: 8, height: 8,
                            decoration: const BoxDecoration(shape: BoxShape.circle, color: Colors.green),
                          ),
                          title: Text(clientId, style: const TextStyle(fontSize: 13, fontFamily: 'monospace')),
                          subtitle: const Text('在线', style: TextStyle(fontSize: 11, color: Colors.green)),
                        )),
                ],
              ),
            ],
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: server.running
                    ? () async {
                        await PlatformService.stopServer(server);
                        setState(() => _servers[index] = server.copyWith(running: false));
                      }
                    : () async {
                        setState(() => _servers[index] = server.copyWith(running: true));
                        await PlatformService.startServer(server, widget.config);
                      },
                icon: Icon(server.running ? Icons.stop_rounded : Icons.play_arrow_rounded, size: 18),
                label: Text(server.running ? '停止' : '启动'),
                style: FilledButton.styleFrom(
                  backgroundColor: server.running ? Colors.red.shade700 : null,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildClientButton(int index, TunnelClientConfig client) {
    final cStatus = client.running
        ? (_clientStatuses[client.id] ?? 'connecting')
        : 'disconnected';
    final bool canStop = cStatus == 'connected' || cStatus == 'connecting' || cStatus == 'reconnecting';
    debugPrint('_buildClientButton: index=$index id=${client.id} running=${client.running} status=$cStatus');
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: canStop
            ? () async {
                debugPrint('stopClient pressed: ${client.id}');
                setState(() => _clients[index] = client.copyWith(running: false));
                await PlatformService.stopClient(client);
              }
            : () async {
                debugPrint('startClient pressed: ${client.id}');
                setState(() => _clients[index] = client.copyWith(running: true));
                await PlatformService.startClient(client, widget.config);
                debugPrint('startClient completed');
              },
        icon: Icon(
          canStop ? Icons.stop_rounded : Icons.play_arrow_rounded,
          size: 18,
        ),
        label: Text(
          canStop ? '停止' : '启动',
        ),
        style: FilledButton.styleFrom(
          backgroundColor: canStop ? Colors.red.shade700 : null,
        ),
      ),
    );
  }

  Widget _buildClientCard(int index, ThemeData theme) {
    final client = _clients[index];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.devices_rounded, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _getCtrl('client_${client.id}_name', client.name),
                    onChanged: (v) {
                      setState(() {
                        _clients[index] = client.copyWith(name: v);
                      });
                      _autoSave();
                    },
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.zero,
                    ),
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                  ),
                ),
                const SizedBox(width: 8),
                _buildClientStatus(_clientStatuses[client.id] ?? 'disconnected'),
                IconButton(
                  icon: Icon(Icons.delete_outline, color: theme.colorScheme.error, size: 20),
                  onPressed: () => _removeClient(index),
                  constraints: const BoxConstraints(),
                  padding: EdgeInsets.zero,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Autocomplete<String>(
                    initialValue: TextEditingValue(text: client.serverHost),
                    optionsBuilder: (textEditingValue) {
                      final available = <String>{'127.0.0.1'};
                      for (final s in _servers) {
                        if (s.bindIp.isNotEmpty) available.add(s.bindIp);
                      }
                      if (textEditingValue.text.isEmpty) return available.toList();
                      return available.where((o) => o.contains(textEditingValue.text)).toList();
                    },
                    fieldViewBuilder: (context, textEditingValue, focusNode, onSubmitted) {
                      return TextField(
                        controller: textEditingValue,
                        focusNode: focusNode,
                        onSubmitted: (v) => onSubmitted(),
                        onChanged: (v) {
                          _syncCtrl('client_${client.id}_serverHost', v);
                          setState(() {
                            _clients[index] = client.copyWith(serverHost: v);
                          });
                          _autoSave();
                        },
                        decoration: const InputDecoration(
                          labelText: '服务器地址',
                          border: OutlineInputBorder(),
                          isDense: true,
                          contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                        ),
                        style: const TextStyle(fontSize: 13),
                      );
                    },
                    onSelected: (v) {
                      _syncCtrl('client_${client.id}_serverHost', v);
                      setState(() {
                        _clients[index] = client.copyWith(serverHost: v);
                      });
                      _autoSave();
                    },
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 80,
                  child: TextField(
                    controller: _getCtrl('client_${client.id}_serverPort', client.serverPort.toString()),
                    onChanged: (v) {
                      _onPortChanged(v, _getCtrl('client_${client.id}_serverPort', ''), (newPort) {
                        setState(() {
                          _clients[index] = client.copyWith(serverPort: newPort);
                        });
                        _autoSave();
                      });
                    },
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: '端口',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _getCtrl('client_${client.id}_password', client.password),
                    onChanged: (v) {
                      final pw = _validatePassword(v);
                      if (pw != v) {
                        _getCtrl('client_${client.id}_password', '').text = pw;
                      }
                      setState(() {
                        _clients[index] = client.copyWith(password: pw);
                      });
                      _autoSave();
                    },
                    obscureText: !_visiblePasswords.contains('client_${client.id}_password'),
                    decoration: InputDecoration(
                      labelText: '密码',
                      border: const OutlineInputBorder(),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _visiblePasswords.contains('client_${client.id}_password')
                              ? Icons.visibility_off
                              : Icons.visibility,
                          size: 18,
                        ),
                        onPressed: () {
                          setState(() {
                            if (_visiblePasswords.contains('client_${client.id}_password')) {
                              _visiblePasswords.remove('client_${client.id}_password');
                            } else {
                              _visiblePasswords.add('client_${client.id}_password');
                            }
                          });
                        },
                        constraints: const BoxConstraints(),
                        padding: EdgeInsets.zero,
                      ),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _getCtrl('client_${client.id}_clientId', client.clientId),
                    onChanged: (v) {
                      setState(() {
                        _clients[index] = client.copyWith(clientId: v);
                      });
                      _autoSave();
                    },
                    decoration: const InputDecoration(
                      labelText: '客户端ID',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _getCtrl('client_${client.id}_sni', client.sni),
              onChanged: (v) {
                setState(() {
                  _clients[index] = client.copyWith(sni: v);
                });
                _autoSave();
              },
              decoration: const InputDecoration(
                labelText: 'SNI',
                border: OutlineInputBorder(),
                isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              ),
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 8),
            _buildPfRuleList(
              client.portForwards,
              'client_${client.id}',
              _clients,
              (updated) {
                setState(() {
                  _clients[index] = client.copyWith(portForwards: updated);
                });
                _autoSave();
              },
              running: client.running,
              instanceId: client.id,
            ),
            const SizedBox(height: 8),
            _buildClientButton(index, client),
          ],
        ),
      ),
    );
  }
}
