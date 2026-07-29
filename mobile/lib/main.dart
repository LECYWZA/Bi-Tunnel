import 'package:flutter/material.dart';
import 'app.dart';
import 'services/platform_service.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  PlatformService.init();
  runApp(const BiTunnelApp());
}
