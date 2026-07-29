import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import '../models/connection_config.dart';

class PlatformService {
  static const _channel = MethodChannel('com.bitunnel.mobile/tunnel');
  static const _eventChannel = EventChannel('com.bitunnel.mobile/tunnel_status');

  static Map<String, dynamic> _lastStatus = {'state': 'disconnected'};
  static Stream<Map<String, dynamic>>? _statusStream;

  static Future<bool> startClient(TunnelClientConfig client, AppConfig config) async {
    try {
      final map = config.toClientMethodChannelMap(client);
      final result = await _channel.invokeMethod<bool>('startClient', map);
      debugPrint('startClient result: $result');
      return result ?? false;
    } on MissingPluginException {
      debugPrint('startClient: MissingPluginException');
      return false;
    } catch (e) {
      debugPrint('startClient error: $e');
      return false;
    }
  }

  static Future<bool> stopClient(TunnelClientConfig client) async {
    try {
      final result = await _channel.invokeMethod<bool>('stopClient', {'id': client.id});
      return result ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> startServer(TunnelServerConfig server, AppConfig config) async {
    try {
      final map = config.toServerMethodChannelMap(server);
      final result = await _channel.invokeMethod<bool>('startServer', map);
      return result ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> stopServer(TunnelServerConfig server) async {
    try {
      final result = await _channel.invokeMethod<bool>('stopServer', {'id': server.id});
      return result ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> startProxy(ProxyInstance proxy, AppConfig config) async {
    try {
      final map = config.toProxyMethodChannelMap(proxy);
      final result = await _channel.invokeMethod<bool>('startProxy', map);
      return result ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> stopProxy(ProxyInstance proxy) async {
    try {
      final result = await _channel.invokeMethod<bool>('stopProxy', {'id': proxy.id});
      return result ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> startPortForward(String instanceId, Map<String, dynamic> rule) async {
    try {
      final result = await _channel.invokeMethod<bool>('startPortForward', {
        'instanceId': instanceId,
        'rule': rule,
      });
      return result ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<bool> stopPortForward(String instanceId, String ruleId) async {
    try {
      final result = await _channel.invokeMethod<bool>('stopPortForward', {
        'instanceId': instanceId,
        'ruleId': ruleId,
      });
      return result ?? false;
    } on MissingPluginException {
      return false;
    }
  }

  static Future<Map<String, dynamic>> getStatus() async {
    try {
      final result = await _channel.invokeMethod<Map<dynamic, dynamic>>('getStatus');
      if (result != null) {
        _lastStatus = Map<String, dynamic>.from(result as Map);
      }
      return _lastStatus;
    } on MissingPluginException {
      return _lastStatus;
    }
  }

  static Stream<Map<String, dynamic>> get statusStream {
    _statusStream ??= _eventChannel
        .receiveBroadcastStream()
        .map((event) {
          final m = Map<String, dynamic>.from(event as Map);
          _lastStatus = m;
          return m;
        });
    return _statusStream!;
  }

  static void init() {
    statusStream.listen((_) {});
  }

  static Future<void> openAppSettings() async {
    try {
      await _channel.invokeMethod('openAppSettings');
    } catch (e) {
      debugPrint('openAppSettings error: $e');
    }
  }

  static Future<void> openNotificationSettings() async {
    try {
      await _channel.invokeMethod('openNotificationSettings');
    } catch (e) {
      debugPrint('openNotificationSettings error: $e');
    }
  }
}
