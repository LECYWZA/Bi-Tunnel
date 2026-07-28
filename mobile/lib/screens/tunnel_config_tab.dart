import 'dart:async';
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
  bool _hasChanges = false;
  final Map<String, TextEditingController> _ctrls = {};
  StreamSubscription<Map<String, dynamic>>? _statusSub;
  Map<String, String> _clientStatuses = {};
  Map<String, List<String>> _serverClients = {};

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

  @override
  void initState() {
    super.initState();
    _servers = List.from(widget.config.servers);
    _clients = List.from(widget.config.clients);
    _statusSub = PlatformService.statusStream.listen((status) {
      try {
        final instances = (status['instances'] as List?) ?? [];
        debugPrint('statusStream: ${instances.length} instances');
        final cStatuses = <String, String>{};
        final sClients = <String, List<String>>{};
        for (final inst in instances) {
          final instMap = Map<String, dynamic>.from(inst as Map);
          final id = instMap['id'] as String? ?? '';
          final type = instMap['type'] as String? ?? '';
          final isRunning = instMap['running'] as bool? ?? false;
          debugPrint('statusStream: id=$id type=$type running=$isRunning');
          if (type == 'client') {
            final s = instMap['status'] as String? ?? 'disconnected';
            cStatuses[id] = s;
            final ci = _clients.indexWhere((c) => c.id == id);
            if (ci >= 0) {
              _clients[ci] = _clients[ci].copyWith(running: s == 'connected');
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
        debugPrint('statusStream error: $e');
      }
    });
  }

  @override
  void didUpdateWidget(covariant TunnelConfigTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    _servers = List.from(widget.config.servers);
    _clients = List.from(widget.config.clients);
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
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _save() {
    final cfg = widget.config.copyWith(servers: _servers, clients: _clients);
    widget.onSave(cfg);
    setState(() => _hasChanges = false);
  }

  void _addClient() {
    setState(() {
      _clients.add(TunnelClientConfig(
        name: '客户端 ${_clients.length + 1}',
        clientId: 'mobile-${_clients.length + 1}',
      ));
      _hasChanges = true;
    });
  }

  void _removeClient(int index) {
    setState(() {
      _clients.removeAt(index);
      _hasChanges = true;
    });
  }

  void _removeServer(int index) {
    setState(() {
      _servers.removeAt(index);
      _hasChanges = true;
    });
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
    void Function(List<PortForwardRule>) onUpdate,
  ) {
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
                          onChanged: (v) {
                            final updated = List<PortForwardRule>.from(rules);
                            updated[i] = rule.copyWith(enabled: v);
                            onUpdate(updated);
                          },
                        ),
                        const Spacer(),
                        IconButton(
                          icon: Icon(Icons.delete_outline, color: Colors.red.shade400, size: 18),
                          onPressed: () {
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
                              final updated = List<PortForwardRule>.from(rules);
                              updated[i] = rule.copyWith(listenPort: int.tryParse(v) ?? 8080);
                              onUpdate(updated);
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
                              final updated = List<PortForwardRule>.from(rules);
                              updated[i] = rule.copyWith(targetPort: int.tryParse(v) ?? 80);
                              onUpdate(updated);
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
                  _hasChanges = true;
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
        if (_hasChanges) ...[
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _save,
              icon: const Icon(Icons.save_rounded),
              label: const Text('保存配置'),
            ),
          ),
        ],
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
                        _hasChanges = true;
                      });
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
                  child: TextField(
                    controller: _getCtrl('server_${server.id}_bindIp', server.bindIp),
                    onChanged: (v) {
                      setState(() {
                        _servers[index] = server.copyWith(bindIp: v);
                        _hasChanges = true;
                      });
                    },
                    decoration: const InputDecoration(
                      labelText: '绑定IP',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _getCtrl('server_${server.id}_listenPort', server.listenPort.toString()),
                    onChanged: (v) {
                      setState(() {
                        _servers[index] = server.copyWith(listenPort: int.tryParse(v) ?? 33891);
                        _hasChanges = true;
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
                      setState(() {
                        _servers[index] = server.copyWith(password: v);
                        _hasChanges = true;
                      });
                    },
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: '密码',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
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
                        _hasChanges = true;
                      });
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
                  _hasChanges = true;
                });
              },
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
    final bool canStop = cStatus == 'connected' || cStatus == 'connecting';
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
                        _hasChanges = true;
                      });
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
                  child: TextField(
                    controller: _getCtrl('client_${client.id}_serverHost', client.serverHost),
                    onChanged: (v) {
                      setState(() {
                        _clients[index] = client.copyWith(serverHost: v);
                        _hasChanges = true;
                      });
                    },
                    decoration: const InputDecoration(
                      labelText: '服务器地址',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 80,
                  child: TextField(
                    controller: _getCtrl('client_${client.id}_serverPort', client.serverPort.toString()),
                    onChanged: (v) {
                      setState(() {
                        _clients[index] = client.copyWith(serverPort: int.tryParse(v) ?? 33891);
                        _hasChanges = true;
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
                      setState(() {
                        _clients[index] = client.copyWith(password: v);
                        _hasChanges = true;
                      });
                    },
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: '密码',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
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
                        _hasChanges = true;
                      });
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
                  _hasChanges = true;
                });
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
                  _hasChanges = true;
                });
              },
            ),
            const SizedBox(height: 8),
            _buildClientButton(index, client),
          ],
        ),
      ),
    );
  }
}
