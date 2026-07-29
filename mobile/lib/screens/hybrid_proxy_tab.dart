import 'dart:async';
import 'package:flutter/material.dart';
import '../models/connection_config.dart';
import '../services/platform_service.dart';

class HybridProxyTab extends StatefulWidget {
  final AppConfig config;
  final void Function(AppConfig) onSave;

  const HybridProxyTab({
    super.key,
    required this.config,
    required this.onSave,
  });

  @override
  State<HybridProxyTab> createState() => _HybridProxyTabState();
}

class _HybridProxyTabState extends State<HybridProxyTab> {
  late List<ProxyInstance> _proxies;
  final Map<String, TextEditingController> _ctrls = {};
  StreamSubscription<Map<String, dynamic>>? _statusSub;
  final Set<String> _visiblePasswords = {};

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
    _proxies = List.from(widget.config.proxies);
    _statusSub = PlatformService.statusStream.listen(_onStatus);
    _syncInitialStatus();
  }

  Future<void> _syncInitialStatus() async {
    try {
      final status = await PlatformService.getStatus();
      if (mounted) _onStatus(status);
    } catch (e) {
      debugPrint('proxy syncInitialStatus error: $e');
    }
  }

  void _onStatus(Map<String, dynamic> status) {
    try {
      final instances = (status['instances'] as List?) ?? [];
      var changed = false;
      for (final inst in instances) {
        final instMap = Map<String, dynamic>.from(inst as Map);
        if ((instMap['type'] as String?) != 'proxy') continue;
        final id = instMap['id'] as String? ?? '';
        final isRunning = instMap['running'] as bool? ?? false;
        final pi = _proxies.indexWhere((p) => p.id == id);
        if (pi >= 0) {
          _proxies[pi] = _proxies[pi].copyWith(running: isRunning);
          changed = true;
        }
      }
      if (mounted && changed) setState(() {});
    } catch (e) {
      debugPrint('proxy onStatus error: $e');
    }
  }

  @override
  void didUpdateWidget(covariant HybridProxyTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    _proxies = List.from(widget.config.proxies);
    for (final p in _proxies) {
      _syncCtrl('proxy_${p.id}_name', p.name);
      _syncCtrl('proxy_${p.id}_bindIp', p.bindIp);
      _syncCtrl('proxy_${p.id}_listenPort', p.listenPort.toString());
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
    final cfg = widget.config.copyWith(proxies: _proxies);
    widget.onSave(cfg);
  }

  void _addProxy() {
    setState(() {
      _proxies.add(ProxyInstance(
        name: '代理 ${_proxies.length + 1}',
      ));
    });
    _autoSave();
  }

  void _removeProxy(int index) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除代理'),
        content: Text('确定删除"${_proxies[index].name}"吗？'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('删除')),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() {
      _proxies.removeAt(index);
    });
    _autoSave();
  }

  Widget _buildStatus(bool running) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
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
            fontSize: 12,
            fontWeight: FontWeight.w600,
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
            Icon(Icons.swap_horiz_rounded, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('混合代理 (${_proxies.length})', style: theme.textTheme.titleMedium),
            const Spacer(),
            TextButton.icon(
              onPressed: _addProxy,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('添加代理'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_proxies.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text('暂无混合代理，点击"添加代理"创建', style: TextStyle(color: Colors.grey.shade500)),
              ),
            ),
          )
        else
          ..._proxies.asMap().entries.map((e) => _buildProxyCard(e.key, theme)),
      ],
    );
  }

  Widget _buildProxyCard(int index, ThemeData theme) {
    final proxy = _proxies[index];
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.swap_horiz_rounded, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _getCtrl('proxy_${proxy.id}_name', proxy.name),
                    onChanged: (v) {
                      setState(() {
                        _proxies[index] = proxy.copyWith(name: v);
                        _autoSave();
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
                _buildStatus(proxy.running),
                IconButton(
                  icon: Icon(Icons.delete_outline, color: theme.colorScheme.error, size: 20),
                  onPressed: () => _removeProxy(index),
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
                    controller: _getCtrl('proxy_${proxy.id}_bindIp', proxy.bindIp),
                    onChanged: (v) {
                      setState(() {
                        _proxies[index] = proxy.copyWith(bindIp: v);
                        _autoSave();
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
                  child: DropdownButtonFormField<String>(
                    value: proxy.mode,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '模式',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'client', child: Text('客户端', style: TextStyle(fontSize: 12))),
                      DropdownMenuItem(value: 'server', child: Text('服务端', style: TextStyle(fontSize: 12))),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      setState(() {
                        _proxies[index] = proxy.copyWith(mode: v);
                        _autoSave();
                      });
                    },
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 100,
                  child: TextField(
                    controller: _getCtrl('proxy_${proxy.id}_listenPort', proxy.listenPort.toString()),
                    onChanged: (v) {
                      final newPort = int.tryParse(v) ?? 0;
                      final conflict = _proxies.asMap().entries.any((e) =>
                        e.key != index && e.value.listenPort == newPort);
                      if (conflict && newPort > 0) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('端口已被其他代理使用'), duration: Duration(seconds: 2)),
                        );
                      }
                      setState(() {
                        _proxies[index] = proxy.copyWith(listenPort: newPort > 0 ? newPort : 1080);
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
            DropdownButtonFormField<ProxyAction>(
              value: proxy.defaultAction,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: '默认动作（未匹配规则时）',
                border: OutlineInputBorder(),
                isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              ),
              items: const [
                DropdownMenuItem(value: ProxyAction.forward, child: Text('转发（通过隧道）', style: TextStyle(fontSize: 12))),
                DropdownMenuItem(value: ProxyAction.direct, child: Text('直连（本地网络）', style: TextStyle(fontSize: 12))),
                DropdownMenuItem(value: ProxyAction.reject, child: Text('拒绝', style: TextStyle(fontSize: 12))),
              ],
              onChanged: (v) {
                if (v == null) return;
                setState(() {
                  _proxies[index] = proxy.copyWith(defaultAction: v);
                  _autoSave();
                });
              },
            ),
            if (proxy.mode == 'server') ...[
              const SizedBox(height: 8),
              TextField(
                controller: _getCtrl('proxy_${proxy.id}_targetClientId', proxy.targetClientId ?? ''),
                onChanged: (v) {
                  setState(() {
                    _proxies[index] = proxy.copyWith(targetClientId: v.isEmpty ? null : v);
                    _autoSave();
                  });
                },
                decoration: const InputDecoration(
                  labelText: '目标客户端ID',
                  border: OutlineInputBorder(),
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                ),
                style: const TextStyle(fontSize: 13),
              ),
            ],
            const SizedBox(height: 8),
            ...proxy.accounts.asMap().entries.map((ae) {
              final ac = ae.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _getCtrl('proxy_${proxy.id}_account_${ae.key}_username', ac.username),
                        onChanged: (v) {
                          final accounts = List<ProxyAccount>.from(proxy.accounts);
                          accounts[ae.key] = ProxyAccount(username: v, password: ac.password, enabled: ac.enabled);
                          setState(() {
                            _proxies[index] = proxy.copyWith(accounts: accounts);
                            _autoSave();
                          });
                        },
                        decoration: const InputDecoration(
                          labelText: '用户名',
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
                        controller: _getCtrl('proxy_${proxy.id}_account_${ae.key}_password', ac.password),
                        onChanged: (v) {
                          final accounts = List<ProxyAccount>.from(proxy.accounts);
                          accounts[ae.key] = ProxyAccount(username: ac.username, password: v, enabled: ac.enabled);
                          setState(() {
                            _proxies[index] = proxy.copyWith(accounts: accounts);
                            _autoSave();
                          });
                        },
                        obscureText: !_visiblePasswords.contains('proxy_${proxy.id}_account_${ae.key}_password'),
                        decoration: InputDecoration(
                          labelText: '密码',
                          border: const OutlineInputBorder(),
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                          suffixIcon: IconButton(
                            icon: Icon(
                              _visiblePasswords.contains('proxy_${proxy.id}_account_${ae.key}_password')
                                  ? Icons.visibility_off
                                  : Icons.visibility,
                              size: 16,
                            ),
                            onPressed: () {
                              setState(() {
                                final key = 'proxy_${proxy.id}_account_${ae.key}_password';
                                if (_visiblePasswords.contains(key)) {
                                  _visiblePasswords.remove(key);
                                } else {
                                  _visiblePasswords.add(key);
                                }
                              });
                            },
                            constraints: const BoxConstraints(),
                            padding: EdgeInsets.zero,
                          ),
                        ),
                        style: const TextStyle(fontSize: 12),
                      ),
                    ),
                    const SizedBox(width: 4),
                    IconButton(
                      icon: Icon(Icons.remove_circle_outline, color: Colors.red.shade400, size: 18),
                      onPressed: () {
                        final accounts = List<ProxyAccount>.from(proxy.accounts);
                        accounts.removeAt(ae.key);
                        setState(() {
                          _proxies[index] = proxy.copyWith(accounts: accounts);
                          _autoSave();
                        });
                      },
                      constraints: const BoxConstraints(),
                      padding: EdgeInsets.zero,
                    ),
                  ],
                ),
              );
            }),
            TextButton.icon(
              onPressed: () {
                final accounts = List<ProxyAccount>.from(proxy.accounts)
                  ..add(ProxyAccount());
                setState(() {
                  _proxies[index] = proxy.copyWith(accounts: accounts);
                  _autoSave();
                });
              },
              icon: const Icon(Icons.person_add_rounded, size: 16),
              label: const Text('添加账号', style: TextStyle(fontSize: 12)),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
            const SizedBox(height: 8),
            ExpansionTile(
              title: Text('关联规则 (${proxy.ruleIds.length})', style: const TextStyle(fontSize: 13)),
              initiallyExpanded: false,
              children: widget.config.rules.isEmpty
                  ? [
                      Padding(
                        padding: const EdgeInsets.all(8),
                        child: Text('暂无规则，请先在"代理规则"中创建',
                            style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
                      ),
                    ]
                  : widget.config.rules.map((rule) {
                      return CheckboxListTile(
                        dense: true,
                        title: Text(rule.name, style: const TextStyle(fontSize: 13)),
                        subtitle: Text(
                          rule.matchType.name,
                          style: TextStyle(color: Colors.grey.shade600, fontSize: 11),
                        ),
                        value: proxy.ruleIds.contains(rule.id),
                        onChanged: (v) {
                          final ids = List<String>.from(proxy.ruleIds);
                          if (v == true) {
                            ids.add(rule.id);
                          } else {
                            ids.remove(rule.id);
                          }
                          setState(() {
                            _proxies[index] = proxy.copyWith(ruleIds: ids);
                            _autoSave();
                          });
                        },
                        controlAffinity: ListTileControlAffinity.leading,
                      );
                    }).toList(),
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: proxy.running
                    ? () async {
                        await PlatformService.stopProxy(proxy);
                        setState(() => _proxies[index] = proxy.copyWith(running: false));
                      }
                    : () async {
                        setState(() => _proxies[index] = proxy.copyWith(running: true));
                        await PlatformService.startProxy(proxy, widget.config);
                      },
                icon: Icon(proxy.running ? Icons.stop_rounded : Icons.play_arrow_rounded, size: 18),
                label: Text(proxy.running ? '停止' : '启动'),
                style: FilledButton.styleFrom(
                  backgroundColor: proxy.running ? Colors.red.shade700 : null,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
