import 'package:flutter/material.dart';
import '../models/tunnel_status.dart';
import 'status_indicator.dart';

class ConnectionCard extends StatelessWidget {
  final TunnelStatus status;
  final String host;
  final int proxyPort;
  final VoidCallback? onToggle;

  const ConnectionCard({
    super.key,
    required this.status,
    required this.host,
    required this.proxyPort,
    this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 2,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.vpn_lock_rounded, color: theme.colorScheme.primary),
                const SizedBox(width: 12),
                Text('隧道连接', style: theme.textTheme.titleMedium),
                const Spacer(),
                StatusIndicator(state: status.state),
              ],
            ),
            const Divider(height: 24),
            _infoRow(Icons.dns_rounded, '服务器', host),
            const SizedBox(height: 8),
            _infoRow(Icons.lan_rounded, '本地代理', '127.0.0.1:$proxyPort'),
            const SizedBox(height: 8),
            _infoRow(Icons.upload_rounded, '上传', _formatBytes(status.bytesSent)),
            const SizedBox(height: 8),
            _infoRow(Icons.download_rounded, '下载', _formatBytes(status.bytesReceived)),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: onToggle,
                icon: Icon(status.state == TunnelState.connected
                    ? Icons.power_settings_new
                    : Icons.power_settings_new),
                label: Text(status.state == TunnelState.connected ? '断开连接' : '开始连接'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Colors.grey),
        const SizedBox(width: 8),
        Text('$label: ', style: const TextStyle(color: Colors.grey)),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w500)),
      ],
    );
  }

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
