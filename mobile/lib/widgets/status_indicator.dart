import 'package:flutter/material.dart';
import '../models/tunnel_status.dart';

class StatusIndicator extends StatelessWidget {
  final TunnelState state;

  const StatusIndicator({super.key, required this.state});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 12,
          height: 12,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: _color,
            boxShadow: [
              BoxShadow(color: _color.withValues(alpha: 0.5), blurRadius: 8),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text(_label, style: TextStyle(color: _color, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Color get _color => switch (state) {
        TunnelState.connected => Colors.green,
        TunnelState.connecting => Colors.orange,
        TunnelState.disconnecting => Colors.orange,
        TunnelState.failed => Colors.red,
        TunnelState.disconnected => Colors.grey,
      };

  String get _label => switch (state) {
        TunnelState.connected => '已连接',
        TunnelState.connecting => '连接中',
        TunnelState.disconnecting => '断开中',
        TunnelState.failed => '连接失败',
        TunnelState.disconnected => '未连接',
      };
}
