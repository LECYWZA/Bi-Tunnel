import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../models/connection_config.dart';

class SecureStorageService {
  static const _storage = FlutterSecureStorage();
  static const _keyConfig = 'app_config';

  static Future<void> saveConfig(AppConfig config) async {
    await _storage.write(key: _keyConfig, value: jsonEncode(config.toJson()));
  }

  static Future<AppConfig> loadConfig() async {
    final json = await _storage.read(key: _keyConfig);
    if (json == null) return const AppConfig();
    try {
      return AppConfig.fromJson(jsonDecode(json) as Map<String, dynamic>);
    } catch (_) {
      return const AppConfig();
    }
  }

  static Future<void> clearConfig() async {
    await _storage.delete(key: _keyConfig);
  }
}
