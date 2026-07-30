import Flutter
import Foundation

public class BiTunnelPlugin: NSObject {
    private let methodChannel: FlutterMethodChannel
    private let eventChannel: FlutterEventChannel
    private var eventSink: FlutterEventSink?
    private let tunnelService = TunnelService()

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

        tunnelService.emitAllStatus()
    }

    private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "startClient":
            guard let args = call.arguments as? [String: Any] else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.startClient(config: args)
            result(true)

        case "stopClient":
            guard let args = call.arguments as? [String: Any],
                  let id = args["id"] as? String else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.stopClient(id: id)
            result(true)

        case "startServer":
            guard let args = call.arguments as? [String: Any] else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.startServer(config: args)
            result(true)

        case "stopServer":
            guard let args = call.arguments as? [String: Any],
                  let id = args["id"] as? String else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.stopServer(id: id)
            result(true)

        case "startProxy":
            guard let args = call.arguments as? [String: Any] else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.startProxy(config: args)
            result(true)

        case "stopProxy":
            guard let args = call.arguments as? [String: Any],
                  let id = args["id"] as? String else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.stopProxy(id: id)
            result(true)

        case "getStatus":
            let status = tunnelService.getStatus()
            result(status)

        case "startPortForward":
            guard let args = call.arguments as? [String: Any],
                  let instanceId = args["instanceId"] as? String,
                  let rule = args["rule"] as? [String: Any] else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.startPortForward(instanceId: instanceId, rule: rule)
            result(true)

        case "stopPortForward":
            guard let args = call.arguments as? [String: Any],
                  let instanceId = args["instanceId"] as? String,
                  let ruleId = args["ruleId"] as? String else {
                result(FlutterError(code: "INVALID_ARGS", message: nil, details: nil))
                return
            }
            tunnelService.stopPortForward(instanceId: instanceId, ruleId: ruleId)
            result(true)

        case "openAppSettings", "openNotificationSettings":
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
            result(true)

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
            // Send initial status
            events(parent?.tunnelService.getStatus() ?? [:])
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
