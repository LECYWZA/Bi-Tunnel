import 'package:flutter/material.dart';
import '../models/connection_config.dart';
import '../services/secure_storage_service.dart';

class ProxyScreen extends StatefulWidget {
  final AppConfig config;

  const ProxyScreen({super.key, required this.config});

  @override
  State<ProxyScreen> createState() => _ProxyScreenState();
}

class _ProxyScreenState extends State<ProxyScreen> {
  late List<ProxyRule> _rules;
  bool _hasChanges = false;

  @override
  void initState() {
    super.initState();
    _rules = List.from(widget.config.rules);
  }

  Future<void> _save() async {
    final cfg = widget.config.copyWith(rules: _rules);
    await SecureStorageService.saveConfig(cfg);
    if (!mounted) return;
    Navigator.pop(context, true);
  }

  void _addRule() {
    setState(() {
      _rules.add(ProxyRule(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        name: '规则 ${_rules.length + 1}',
        matchType: MatchType.any,
        action: RuleAction.forward,
        enabled: true,
        order: _rules.length,
      ));
      _hasChanges = true;
    });
  }

  void _removeRule(int index) {
    setState(() {
      _rules.removeAt(index);
      _hasChanges = true;
    });
  }

  void _moveRule(int oldIndex, int newIndex) {
    setState(() {
      if (newIndex > oldIndex) newIndex--;
      final item = _rules.removeAt(oldIndex);
      _rules.insert(newIndex, item);
      for (var i = 0; i < _rules.length; i++) {
        _rules[i] = _rules[i].copyWith(order: i);
      }
      _hasChanges = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('混合代理'),
        actions: [
          TextButton(
            onPressed: _hasChanges ? _save : null,
            child: const Text('保存'),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                Icon(Icons.alt_route_rounded, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('代理规则 (${_rules.length})', style: theme.textTheme.titleMedium),
                const Spacer(),
                TextButton.icon(
                  onPressed: _addRule,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('添加规则'),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              '规则按顺序匹配，命中后执行对应动作',
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _rules.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.alt_route_rounded, size: 48, color: Colors.grey.shade600),
                        const SizedBox(height: 8),
                        Text('暂无代理规则', style: TextStyle(color: Colors.grey.shade500)),
                        const SizedBox(height: 4),
                        TextButton.icon(
                          onPressed: _addRule,
                          icon: const Icon(Icons.add, size: 16),
                          label: const Text('添加第一条规则'),
                        ),
                      ],
                    ),
                  )
                : ReorderableListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    itemCount: _rules.length,
                    onReorder: _moveRule,
                    itemBuilder: (_, i) => _buildRuleCard(i, theme),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildRuleCard(int index, ThemeData theme) {
    final rule = _rules[index];

    return Card(
      key: ValueKey(rule.id),
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                ReorderableDragStartListener(
                  index: index,
                  child: const Icon(Icons.drag_handle, color: Colors.grey),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: TextField(
                    controller: TextEditingController(text: rule.name)
                      ..selection = TextSelection.collapsed(offset: rule.name.length),
                    onChanged: (v) {
                      setState(() {
                        _rules[index] = rule.copyWith(name: v);
                        _hasChanges = true;
                      });
                    },
                    decoration: const InputDecoration(
                      hintText: '规则名称',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                  ),
                ),
                const SizedBox(width: 8),
                Switch(
                  value: rule.enabled,
                  onChanged: (v) {
                    setState(() {
                      _rules[index] = rule.copyWith(enabled: v);
                      _hasChanges = true;
                    });
                  },
                ),
                IconButton(
                  icon: Icon(Icons.delete_outline, color: theme.colorScheme.error, size: 20),
                  onPressed: () => _removeRule(index),
                  constraints: const BoxConstraints(),
                  padding: EdgeInsets.zero,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<MatchType>(
                    value: rule.matchType,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '匹配类型',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    items: const [
                      DropdownMenuItem(value: MatchType.any, child: Text('全部流量')),
                      DropdownMenuItem(value: MatchType.domain, child: Text('域名')),
                      DropdownMenuItem(value: MatchType.ip, child: Text('IP 地址')),
                      DropdownMenuItem(value: MatchType.cidr, child: Text('IP 段 (CIDR)')),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      setState(() {
                        _rules[index] = rule.copyWith(matchType: v, matchValue: '');
                        _hasChanges = true;
                      });
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<RuleAction>(
                    value: rule.action,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: '动作',
                      border: OutlineInputBorder(),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                    ),
                    items: const [
                      DropdownMenuItem(value: RuleAction.forward, child: Text('走隧道')),
                      DropdownMenuItem(value: RuleAction.direct, child: Text('直连')),
                      DropdownMenuItem(value: RuleAction.reject, child: Text('拒绝')),
                    ],
                    onChanged: (v) {
                      if (v == null) return;
                      setState(() {
                        _rules[index] = rule.copyWith(action: v);
                        _hasChanges = true;
                      });
                    },
                  ),
                ),
              ],
            ),
            if (rule.matchType != MatchType.any) ...[
              const SizedBox(height: 8),
              TextField(
                controller: TextEditingController(text: rule.matchValue)
                  ..selection = TextSelection.collapsed(offset: rule.matchValue.length),
                onChanged: (v) {
                  setState(() {
                    _rules[index] = rule.copyWith(matchValue: v);
                    _hasChanges = true;
                  });
                },
                decoration: InputDecoration(
                  hintText: switch (rule.matchType) {
                    MatchType.domain => 'example.com',
                    MatchType.ip => '8.8.8.8',
                    MatchType.cidr => '10.0.0.0/8',
                    _ => '',
                  },
                  border: const OutlineInputBorder(),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                ),
                style: const TextStyle(fontSize: 14, fontFamily: 'monospace'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
