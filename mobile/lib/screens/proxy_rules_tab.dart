import 'package:flutter/material.dart';
import '../models/connection_config.dart';

class ProxyRulesTab extends StatefulWidget {
  final AppConfig config;
  final ValueChanged<List<ProxyRule>> onChanged;

  const ProxyRulesTab({
    super.key,
    required this.config,
    required this.onChanged,
  });

  @override
  State<ProxyRulesTab> createState() => _ProxyRulesTabState();
}

class _ProxyRulesTabState extends State<ProxyRulesTab> {
  late List<ProxyRule> _rules;
  final Map<String, TextEditingController> _ctrls = {};

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
    _rules = List.from(widget.config.rules);
  }

  @override
  void didUpdateWidget(covariant ProxyRulesTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    _rules = List.from(widget.config.rules);
    for (final r in _rules) {
      _syncCtrl('rule_${r.id}_name', r.name);
      _syncCtrl('rule_${r.id}_matchValue', r.matchValue);
    }
  }

  @override
  void dispose() {
    for (final c in _ctrls.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _notify() {
    widget.onChanged(List.from(_rules));
  }

  void _addRule() {
    setState(() {
      _rules.add(ProxyRule(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        name: '规则 ${_rules.length + 1}',
        matchType: MatchType.auto,
        enabled: true,
        order: _rules.length,
      ));
    });
    _notify();
  }

  void _removeRule(int index) {
    setState(() => _rules.removeAt(index));
    _notify();
  }

  void _moveRule(int oldIndex, int newIndex) {
    setState(() {
      if (newIndex > oldIndex) newIndex--;
      final item = _rules.removeAt(oldIndex);
      _rules.insert(newIndex, item);
      for (var i = 0; i < _rules.length; i++) {
        _rules[i] = _rules[i].copyWith(order: i);
      }
    });
    _notify();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
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
                    controller: _getCtrl('rule_${rule.id}_name', rule.name),
                    onChanged: (v) {
                      setState(() => _rules[index] = rule.copyWith(name: v));
                      _notify();
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
                    setState(() => _rules[index] = rule.copyWith(enabled: v));
                    _notify();
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
            TextField(
              controller: _getCtrl('rule_${rule.id}_matchValue', rule.matchValue),
              minLines: 3,
              maxLines: null,
              onChanged: (v) {
                setState(() => _rules[index] = rule.copyWith(matchValue: v));
                _notify();
              },
              decoration: const InputDecoration(
                hintText: '每行一个值，支持换行输入多条',
                border: OutlineInputBorder(),
                isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 8, vertical: 8),
              ),
              style: const TextStyle(fontSize: 14, fontFamily: 'monospace'),
            ),
            const SizedBox(height: 4),
            Text(
              '自动识别：*.example.com（域名） | 8.8.8.8（IP） | 10.0.0.0/8（CIDR）',
              style: TextStyle(color: Colors.grey.shade500, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}
