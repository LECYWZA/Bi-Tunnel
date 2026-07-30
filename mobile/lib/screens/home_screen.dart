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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          ['隧道配置', '混合代理', '代理测试台'][_currentIndex],
        ),
        centerTitle: true,
      ),
      body: IndexedStack(
        index: _currentIndex,
        children: [
          TunnelConfigTab(
            config: _config,
            onSave: _saveConfig,
          ),
          HybridProxyTab(
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
