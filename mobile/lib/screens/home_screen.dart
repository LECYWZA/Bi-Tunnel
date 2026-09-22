import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../models/connection_config.dart';
import '../services/platform_service.dart';
import '../services/secure_storage_service.dart';
import 'tunnel_config_tab.dart';
import 'hybrid_proxy_tab.dart';
import 'proxy_test_tab.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _currentIndex = 0;
  int _configRevision = 0;
  AppConfig _config = const AppConfig();
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final config = await SecureStorageService.loadConfig();
    if (mounted) {
      setState(() {
        _config = config;
      });
    }
    _loaded = true;
  }

  void _saveConfig(AppConfig newConfig) {
    SecureStorageService.saveConfig(newConfig);
    setState(() {
      _config = newConfig;
    });
  }

  // JSONC -> JSON: 剥离注释(//、/* */)与尾逗号(字符串内不受影响)
  static String _stripJsonc(String text) {
    final out = StringBuffer();
    var inStr = false;
    var strCh = '';
    var i = 0;
    final n = text.length;
    while (i < n) {
      final ch = text[i];
      final next = i + 1 < n ? text[i + 1] : '';
      if (inStr) {
        out.write(ch);
        if (ch == '\\') {
          out.write(next);
          i += 2;
          continue;
        }
        if (ch == strCh) inStr = false;
        i++;
        continue;
      }
      if (ch == '"' || ch == "'") {
        inStr = true;
        strCh = ch;
        out.write(ch);
        i++;
        continue;
      }
      if (ch == '/' && next == '/') {
        while (i < n && text[i] != '\n') {
          i++;
        }
        out.write('\n');
        continue;
      }
      if (ch == '/' && next == '*') {
        i += 2;
        while (i < n && !(text[i] == '*' && i + 1 < n && text[i + 1] == '/')) {
          i++;
        }
        i += 2;
        continue;
      }
      if (ch == ',') {
        var j = i + 1;
        while (j < n && (text[j] == ' ' || text[j] == '\t' || text[j] == '\r' || text[j] == '\n')) {
          j++;
        }
        if (j < n && (text[j] == '}' || text[j] == ']')) {
          i++;
          continue;
        }
      }
      out.write(ch);
      i++;
    }
    return out.toString();
  }

  Future<void> _exportConfig() async {
    try {
      final now = DateTime.now();
      final dateStr = '${now.year}${now.month.toString().padLeft(2, '0')}${now.day.toString().padLeft(2, '0')}';
      final jsonc = [
        '// Bi-Tunnel 移动端配置导出',
        '// 时间: ${now.toIso8601String()}',
        '// 包含: 隧道配置 + 混合代理配置',
        const JsonEncoder.withIndent('  ').convert(_config.toJson()),
      ].join('\n');
      final defaultName = 'bitunnel-config-$dateStr.jsonc';
      final savePath = await FilePicker.platform.saveFile(
        dialogTitle: '导出配置',
        fileName: defaultName,
        type: FileType.custom,
        allowedExtensions: ['jsonc', 'json'],
      );
      if (savePath == null) return; // 用户取消
      final file = File(savePath);
      await file.writeAsString(jsonc);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('配置已导出到 $savePath')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('导出失败: $e')),
        );
      }
    }
  }

  Future<void> _importConfig() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        dialogTitle: '导入配置',
        type: FileType.custom,
        allowedExtensions: ['jsonc', 'json'],
        withData: true,
      );
      if (result == null || result.files.isEmpty) return;
      final picked = result.files.single;
      String content;
      if (picked.bytes != null) {
        content = utf8.decode(picked.bytes!);
      } else if (picked.path != null) {
        content = await File(picked.path!).readAsString();
      } else {
        throw Exception('无法读取文件内容');
      }
      final map = jsonDecode(_stripJsonc(content.replaceFirst('\uFEFF', '')))
          as Map<String, dynamic>;
      final newConfig = AppConfig.fromJson(map);
      _saveConfig(newConfig);
      setState(() {
        _configRevision++;
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('配置导入成功(${newConfig.servers.length} 服务端 / ${newConfig.clients.length} 客户端 / ${newConfig.proxies.length} 代理)')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('导入失败: $e')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          ['隧道配置', '混合代理', '代理测试台'][_currentIndex],
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.file_download_outlined),
            tooltip: '导出配置 (JSONC)',
            onPressed: _exportConfig,
          ),
          IconButton(
            icon: const Icon(Icons.file_upload_outlined),
            tooltip: '导入配置',
            onPressed: _importConfig,
          ),
        ],
      ),
      body: IndexedStack(
        index: _currentIndex,
        children: [
          TunnelConfigTab(
            key: ValueKey('tunnel_$_configRevision'),
            config: _config,
            onSave: _saveConfig,
          ),
          HybridProxyTab(
            key: ValueKey('hybrid_$_configRevision'),
            config: _config,
            onSave: _saveConfig,
          ),
          const ProxyTestTab(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (i) => setState(() => _currentIndex = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.vpn_lock_rounded),
            selectedIcon: Icon(Icons.vpn_lock_rounded),
            label: '隧道配置',
          ),
          NavigationDestination(
            icon: Icon(Icons.swap_horiz_rounded),
            selectedIcon: Icon(Icons.swap_horiz_rounded),
            label: '混合代理',
          ),
          NavigationDestination(
            icon: Icon(Icons.science_rounded),
            selectedIcon: Icon(Icons.science_rounded),
            label: '代理测试台',
          ),
        ],
      ),
    );
  }
}
