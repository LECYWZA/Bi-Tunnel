import Flutter
import Foundation

public class BiTunnelPlugin: NSObject {
    private let methodChannel: FlutterMethodChannel
    private let eventChannel: FlutterEventChannel
    private var eventSink: FlutterEventSink?
    private var tunnelService: TunnelService?

    init(messenger: FlutterBinaryMessenger) {
        methodChannel = FlutterMethodChannel(
            name: "com.bitunnel.mobile/tunnel",
            binaryMessenger: messenger
        )
        eventChannel = FlutterEventChannel(
            name: "com.bitunnel.mobile/tunnel_status",
            binaryMessenger: messenger
        )
        super.init()

        methodChannel.setMethodCallHandler { [weak self] call, result in
            self?.handle(call, result: result)
        }

        eventChannel.setStreamHandler(StatusStreamHandler(parent: self))
    }

    private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "connect":
            guard let args = call.arguments as? [String: Any] else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService = TunnelService()
            tunnelService?.statusCallback = { [weak self] status in
                self?.eventSink?(status)
            }
            tunnelService?.connect(config: args)
            result(true)

        case "disconnect":
            tunnelService?.disconnect()
            tunnelService = nil
            result(true)

        case "getStatus":
            result([
                "state": tunnelService?.state ?? "disconnected",
                "bytesSent": tunnelService?.bytesSent ?? 0,
                "bytesReceived": tunnelService?.bytesReceived ?? 0,
                "connectedDuration": tunnelService?.connectedDuration ?? 0,
            ] as [String: Any])

        default:
            result(FlutterMethodNotImplemented)
        }
    }

    private class StatusStreamHandler: NSObject, FlutterStreamHandler {
        weak var parent: BiTunnelPlugin?

        init(parent: BiTunnelPlugin) {
            self.parent = parent
        }

        func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
            parent?.eventSink = events
            TunnelService.statusCallback = { status in
                events(status)
            }
            return nil
        }

        func onCancel(withArguments arguments: Any?) -> FlutterError? {
            parent?.eventSink = nil
            TunnelService.statusCallback = nil
            return nil
        }
    }

    deinit {
        methodChannel.setMethodCallHandler(nil)
        eventChannel.setStreamHandler(nil)
    }
}
