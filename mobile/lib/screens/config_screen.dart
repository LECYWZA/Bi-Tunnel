import 'package:flutter/material.dart';
import '../models/connection_config.dart';
import '../services/secure_storage_service.dart';

class ConfigScreen extends StatefulWidget {
  final AppConfig? config;

  const ConfigScreen({super.key, this.config});

  @override
  State<ConfigScreen> createState() => _ConfigScreenState();
}

class _ConfigScreenState extends State<ConfigScreen> {
  late final TextEditingController _hostCtrl;
  late final TextEditingController _portCtrl;
  late final TextEditingController _passCtrl;
  late final TextEditingController _sniCtrl;
  late final TextEditingController _proxyPortCtrl;
  bool _showPassword = false;
  bool _showPasswords = false;
  bool _hasChanges = false;

  late ServerConfig _server;
  List<ClientProfile> _clients = [];
  String? _selectedClientId;

  @override
  void initState() {
    super.initState();
    final cfg = widget.config ?? const AppConfig();
    _server = cfg.server;
    _clients = List.from(cfg.clients);
    _selectedClientId = cfg.selectedClientId;

    _hostCtrl = TextEditingController(text: _server.host);
    _portCtrl = TextEditingController(text: _server.port.toString());
    _passCtrl = TextEditingController(text: _server.password);
    _sniCtrl = TextEditingController(text: _server.sni);
    _proxyPortCtrl = TextEditingController(text: cfg.localProxyPort.toString());
  }

  @override
  void dispose() {
    _hostCtrl.dispose();
    _portCtrl.dispose();
    _passCtrl.dispose();
    _sniCtrl.dispose();
    _proxyPortCtrl.dispose();
    super.dispose();
  }

  void _markChanged() {
    if (!_hasChanges) setState(() => _hasChanges = true);
  }

  Future<void> _save() async {
    final config = AppConfig(
      server: ServerConfig(
        host: _hostCtrl.text.trim(),
        port: int.tryParse(_portCtrl.text.trim()) ?? 33891,
        password: _passCtrl.text,
        sni: _sniCtrl.text.trim().isNotEmpty ? _sniCtrl.text.trim() : 'mail.qq.com',
      ),
      clients: _clients,
      selectedClientId: _selectedClientId,
      localProxyPort: int.tryParse(_proxyPortCtrl.text.trim()) ?? 1080,
      autoStart: widget.config?.autoStart ?? false,
    );
    await SecureStorageService.saveConfig(config);
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  void _addClient() {
    setState(() {
      _clients.add(ClientProfile(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        name: '手机-${_clients.length + 1}',
        clientId: 'mobile-${_clients.length + 1}',
      ));
      _hasChanges = true;
    });
  }

  void _removeClient(int index) {
    final id = _clients[index].id;
    setState(() {
      _clients.removeAt(index);
      if (_selectedClientId == id) _selectedClientId = null;
      _hasChanges = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('隧道配置'),
        actions: [
          TextButton(
            onPressed: _hasChanges ? _save : null,
            child: const Text('保存'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildServerCard(theme),
          const SizedBox(height: 24),
          _buildClientSection(theme),
        ],
      ),
    );
  }

  Widget _buildServerCard(ThemeData theme) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.dns_rounded, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('服务端', style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _hostCtrl,
              onChanged: (_) => _markChanged(),
              decoration: const InputDecoration(
                labelText: '服务器地址',
                hintText: 'example.com 或 IP',
                prefixIcon: Icon(Icons.dns_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _portCtrl,
              onChanged: (_) => _markChanged(),
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: '隧道端口',
                hintText: '33891',
                prefixIcon: Icon(Icons.numbers_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _passCtrl,
              onChanged: (_) => _markChanged(),
              obscureText: !_showPassword,
              decoration: InputDecoration(
                labelText: '连接密码',
                prefixIcon: const Icon(Icons.lock_rounded),
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: Icon(_showPassword ? Icons.visibility_off : Icons.visibility),
                  onPressed: () => setState(() => _showPassword = !_showPassword),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _sniCtrl,
              onChanged: (_) => _markChanged(),
              decoration: const InputDecoration(
                labelText: 'SNI',
                hintText: 'mail.qq.com',
                prefixIcon: Icon(Icons.security_rounded),
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildClientSection(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.devices_rounded, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('客户端 (${_clients.length})', style: theme.textTheme.titleMedium),
            const Spacer(),
            TextButton.icon(
              onPressed: _addClient,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('添加'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_clients.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Center(
                child: Text('暂无客户端，点击"添加"创建', style: theme.textTheme.bodyMedium?.copyWith(color: Colors.grey)),
              ),
            ),
          )
        else
          ..._clients.asMap().entries.map((entry) => _buildClientCard(entry.key, theme)),
      ],
    );
  }

  Widget _buildClientCard(int index, ThemeData theme) {
    final client = _clients[index];
    final isSelected = client.id == _selectedClientId;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                _ClientIdEditor(
                  initialValue: client.name,
                  onChanged: (v) {
                    setState(() {
                      _clients[index] = client.copyWith(name: v);
                      _hasChanges = true;
                    });
                  },
                  hint: '显示名称',
                ),
                const Spacer(),
                if (isSelected)
                  Chip(
                    label: const Text('使用中', style: TextStyle(fontSize: 11)),
                    visualDensity: VisualDensity.compact,
                    backgroundColor: theme.colorScheme.primaryContainer,
                  ),
                IconButton(
                  icon: Icon(Icons.delete_outline, color: theme.colorScheme.error, size: 20),
                  onPressed: () => _removeClient(index),
                  constraints: const BoxConstraints(),
                  padding: const EdgeInsets.only(left: 8),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: TextEditingController(text: client.clientId)
                      ..selection = TextSelection.collapsed(offset: client.clientId.length),
                    onChanged: (v) {
                      setState(() {
                        _clients[index] = _clients[index].copyWith(clientId: v);
                        _hasChanges = true;
                      });
                    },
                    decoration: const InputDecoration(
                      labelText: '客户端 ID',
                      hintText: 'mobile-1',
                      prefixIcon: Icon(Icons.badge_rounded, size: 18),
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    style: const TextStyle(fontSize: 14),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: isSelected
                      ? null
                      : () {
                          setState(() {
                            _selectedClientId = client.id;
                            _hasChanges = true;
                          });
                        },
                  child: const Text('选用'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ClientIdEditor extends StatefulWidget {
  final String initialValue;
  final ValueChanged<String> onChanged;
  final String hint;

  const _ClientIdEditor({
    required this.initialValue,
    required this.onChanged,
    required this.hint,
  });

  @override
  State<_ClientIdEditor> createState() => _ClientIdEditorState();
}

class _ClientIdEditorState extends State<_ClientIdEditor> {
  late TextEditingController _ctrl;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: widget.initialValue);
  }

  @override
  void didUpdateWidget(covariant _ClientIdEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialValue != oldWidget.initialValue && _ctrl.text != widget.initialValue) {
      _ctrl.text = widget.initialValue;
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 160,
      child: TextField(
        controller: _ctrl,
        onChanged: widget.onChanged,
        decoration: InputDecoration(
          hintText: widget.hint,
          border: const OutlineInputBorder(),
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        ),
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
      ),
    );
  }
}
