enum TunnelState { disconnected, connecting, connected, disconnecting, failed }

class TunnelStatus {
  final TunnelState state;
  final int bytesSent;
  final int bytesReceived;
  final int connectedDuration;
  final String? error;

  const TunnelStatus({
    this.state = TunnelState.disconnected,
    this.bytesSent = 0,
    this.bytesReceived = 0,
    this.connectedDuration = 0,
    this.error,
  });

  TunnelStatus copyWith({
    TunnelState? state,
    int? bytesSent,
    int? bytesReceived,
    int? connectedDuration,
    String? error,
  }) {
    return TunnelStatus(
      state: state ?? this.state,
      bytesSent: bytesSent ?? this.bytesSent,
      bytesReceived: bytesReceived ?? this.bytesReceived,
      connectedDuration: connectedDuration ?? this.connectedDuration,
      error: error ?? this.error,
    );
  }
}
