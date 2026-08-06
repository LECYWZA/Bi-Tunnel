import Foundation
import AVFoundation
import UIKit
import Network
import CryptoKit

// MARK: - Data Models

struct ClientState {
    let id: String
    let host: String
    let port: Int
    let password: String
    let clientId: String
    let sni: String
    let proxyPort: Int
    let rules: [ProxyRule]
    let portForwards: [[String: Any]]
}

struct ServerState {
    let id: String
    let listenPort: Int
    let password: String
    let sni: String
    let bindIp: String
}

// MARK: - TunnelService

class TunnelService: NSObject {
    static var statusCallback: (([String: Any]) -> Void)?

    private var audioPlayer: AVAudioPlayer?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    // Runners
    var clientRunners: [String: ClientRunner] = [:]
    var serverRunners: [String: ServerRunner] = [:]
    var proxyRunners: [String: ProxyRunner] = [:]
    var pfRunners: [String: [String: PfRunnerInfo]] = [:]
    private let runnersLock = NSLock()

    override init() {
        super.init()
        setupAudio()
        observeLifecycle()
    }

    // MARK: - Audio Keepalive

    private func setupAudio() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleAudioInterruption),
            name: AVAudioSession.interruptionNotification, object: nil)
    }

    private func observeLifecycle() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(willEnterForeground),
            name: UIApplication.willEnterForegroundNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(didEnterBackground),
            name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func willEnterForeground() { ensureAudioSession() }

    @objc private func didEnterBackground() {
        startBackgroundTask()
        startSilentAudio()
    }

    private func ensureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[BiTunnel] Audio session error: \(error)")
        }
    }

    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        if type == .ended { startSilentAudio() }
    }

    private func startSilentAudio() {
        ensureAudioSession()
        guard let path = Bundle.main.path(forResource: "silence", ofType: "mp3") else {
            print("[BiTunnel] silence.mp3 not found")
            return
        }
        do {
            audioPlayer = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: path))
            audioPlayer?.volume = 0
            audioPlayer?.numberOfLoops = -1
            audioPlayer?.play()
        } catch {
            print("[BiTunnel] Audio player error: \(error)")
        }
    }

    private func stopSilentAudio() {
        audioPlayer?.stop()
        audioPlayer = nil
    }

    // MARK: - Background Task

    private func startBackgroundTask() {
        backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
    }

    // MARK: - Client Operations

    func startClient(config: [String: Any]) {
        let id = config["id"] as? String ?? UUID().uuidString
        runnersLock.lock()
        if clientRunners[id] != nil {
            runnersLock.unlock()
            print("[BiTunnel] Client runner already exists: \(id)")
            return
        }
        let runner = ClientRunner(service: self, config: config)
        clientRunners[id] = runner
        runnersLock.unlock()
        runner.start()
        emitAllStatus()
    }

    func stopClient(id: String) {
        runnersLock.lock()
        let runner = clientRunners.removeValue(forKey: id)
        pfRunners.removeValue(forKey: id)?.values.forEach { $0.stop() }
        runnersLock.unlock()
        runner?.stop()
        emitAllStatus()
    }

    // MARK: - Server Operations

    func startServer(config: [String: Any]) {
        let id = config["id"] as? String ?? UUID().uuidString
        runnersLock.lock()
        let old = serverRunners.removeValue(forKey: id)
        let runner = ServerRunner(service: self, config: config)
        serverRunners[id] = runner
        runnersLock.unlock()
        old?.stop()
        runner.start()
        emitAllStatus()
    }

    func stopServer(id: String) {
        runnersLock.lock()
        let runner = serverRunners.removeValue(forKey: id)
        runnersLock.unlock()
        runner?.stop()
        emitAllStatus()
    }

    // MARK: - Proxy Operations

    func startProxy(config: [String: Any]) {
        let id = config["id"] as? String ?? UUID().uuidString
        runnersLock.lock()
        let old = proxyRunners.removeValue(forKey: id)
        let runner = ProxyRunner(service: self, config: config)
        proxyRunners[id] = runner
        runnersLock.unlock()
        old?.stop()
        runner.start()
        emitAllStatus()
    }

    func stopProxy(id: String) {
        runnersLock.lock()
        let runner = proxyRunners.removeValue(forKey: id)
        runnersLock.unlock()
        runner?.stop()
        emitAllStatus()
    }

    // MARK: - Port Forward

    func startPortForward(instanceId: String, rule: [String: Any]) {
        let ruleId = rule["id"] as? String ?? UUID().uuidString
        var session: MuxSession?
        runnersLock.lock()
        if let client = clientRunners[instanceId] {
            session = client.session
        }
        runnersLock.unlock()
        guard let mux = session else {
            print("[BiTunnel] startPortForward: no session for \(instanceId)")
            return
        }
        stopPortForward(instanceId: instanceId, ruleId: ruleId)

        guard let pfListenPort = rule["listenPort"] as? Int else { return }
        guard let pfTargetHost = rule["targetHost"] as? String else { return }
        guard let pfTargetPort = rule["targetPort"] as? Int else { return }

        do {
            let params = NWParameters.tcp
            let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: UInt16(pfListenPort))!)
            let info = PfRunnerInfo(listener: listener)
            runnersLock.lock()
            var runners = pfRunners[instanceId] ?? [:]
            runners[ruleId] = info
            pfRunners[instanceId] = runners
            runnersLock.unlock()

            listener.newConnectionHandler = { [weak self] conn in
                guard let self = self else { return }
                TunnelService.handleProxyRequest(mux: mux, targetHost: pfTargetHost, targetPort: pfTargetPort, clientConn: conn)
            }
            listener.start(queue: DispatchQueue.global())
            print("[BiTunnel] Port forward \(ruleId) on \(pfListenPort) -> \(pfTargetHost):\(pfTargetPort)")
        } catch {
            print("[BiTunnel] Port forward error: \(error)")
        }
    }

    func stopPortForward(instanceId: String, ruleId: String) {
        runnersLock.lock()
        let info = pfRunners[instanceId]?.removeValue(forKey: ruleId)
        if pfRunners[instanceId]?.isEmpty == true {
            pfRunners.removeValue(forKey: instanceId)
        }
        runnersLock.unlock()
        info?.stop()
    }

    // MARK: - Handle Proxy Request (forward over mux)

    static var channelIdCounter: UInt32 = 1
    private static let channelIdLock = NSLock()

    static func handleProxyRequest(mux: MuxSession, targetHost: String, targetPort: Int, clientConn: NWConnection) {
        channelIdLock.lock()
        let channelId = channelIdCounter
        channelIdCounter += 2
        channelIdLock.unlock()

        let queue = mux.subscribeChannel(channelId)
        let relayQueue = DispatchQueue(label: "mux-relay-\(channelId)")

        relayQueue.async {
            mux.sendCreate(channelId: channelId, host: targetHost, port: targetPort)

            // Wait for ACK
            let ackTimeout: TimeInterval = 15.0
            let ackDeadline = Date().addingTimeInterval(ackTimeout)
            var ackOk = false
            while Date() < ackDeadline {
                guard let frame = queue.poll(timeout: .now() + .milliseconds(500)) else { continue }
                if frame.type == MuxSession.TYPE_CREATE_ACK {
                    ackOk = frame.payload.count > 0 && frame.payload[0] == 1
                    break
                }
            }

            guard ackOk else {
                mux.unsubscribeChannel(channelId)
                clientConn.cancel()
                return
            }

            clientConn.start(queue: relayQueue)

            // Write from mux queue to client
            let writeQueue = DispatchQueue(label: "write-client-\(channelId)")
            writeQueue.async {
                while mux.isAuthenticated && !mux.isClosed {
                    guard let frame = queue.poll(timeout: .now() + .milliseconds(500)) else { continue }
                    switch frame.type {
                    case MuxSession.TYPE_DATA:
                        clientConn.send(content: frame.payload, completion: .contentProcessed { _ in })
                    case MuxSession.TYPE_CLOSE:
                        clientConn.cancel()
                        mux.unsubscribeChannel(channelId)
                        return
                    default:
                        break
                    }
                }
            }

            // Read from client and send over mux
            func readClient() {
                guard mux.isAuthenticated && !mux.isClosed else {
                    mux.sendClose(channelId: channelId)
                    mux.unsubscribeChannel(channelId)
                    clientConn.cancel()
                    return
                }
                clientConn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, error in
                    guard let d = data, !d.isEmpty, error == nil else {
                        mux.sendClose(channelId: channelId)
                        mux.unsubscribeChannel(channelId)
                        clientConn.cancel()
                        return
                    }
                    mux.sendData(channelId: channelId, data: d)
                    readClient()
                }
            }
            readClient()
        }
    }

    // MARK: - Status

    func getStatus() -> [String: Any] {
        var instances: [[String: Any]] = []
        runnersLock.lock()
        for (id, runner) in clientRunners {
            instances.append([
                "id": id, "type": "client",
                "running": runner.running, "status": runner.status,
                "error": runner.error ?? NSNull()
            ])
        }
        for (id, runner) in serverRunners {
            instances.append([
                "id": id, "type": "server",
                "running": runner.running,
                "connectedClients": runner.connectedClients,
                "error": runner.error ?? NSNull()
            ])
        }
        for (id, runner) in proxyRunners {
            instances.append([
                "id": id, "type": "proxy",
                "running": runner.running,
                "error": runner.error ?? NSNull()
            ])
        }
        runnersLock.unlock()
        return ["state": "running", "instances": instances]
    }

    func emitAllStatus() {
        let status = getStatus()
        if Thread.isMainThread {
            Self.statusCallback?(status)
        } else {
            DispatchQueue.main.async {
                Self.statusCallback?(status)
            }
        }
    }
}

// MARK: - ClientRunner

class ClientRunner {
    let id: String
    private let config: [String: Any]
    weak var service: TunnelService?

    private(set) var running = false
    private(set) var status = "disconnected"
    private(set) var error: String?
    private(set) var session: MuxSession?

    private var proxy: Socks5Proxy?
    private var workerQueue: DispatchQueue?
    private var tlsConnection: NWConnection?

    init(service: TunnelService, config: [String: Any]) {
        self.service = service
        self.config = config
        self.id = config["id"] as? String ?? UUID().uuidString
    }

    func start() {
        running = true
        status = "connecting"
        service?.emitAllStatus()

        let queue = DispatchQueue(label: "client-runner-\(id)")
        workerQueue = queue
        queue.async { [weak self] in
            guard let self = self else { return }
            var reconnectAttempt = 0

            while self.running {
                do {
                    let host = self.config["serverHost"] as? String ?? ""
                    guard !host.isEmpty else { throw NSError(domain: "BiTunnel", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing serverHost"]) }
                    let port = self.config["serverPort"] as? Int ?? 33891
                    let password = self.config["password"] as? String ?? ""
                    let clientId = self.config["clientId"] as? String ?? "mobile-1"
                    let sni = self.config["sni"] as? String ?? "mail.qq.com"
                    let proxyPort = self.config["localProxyPort"] as? Int ?? 1080
                    let rules = self.parseRules(self.config["rules"])

                    print("[ClientRunner] \(clientId) connecting to \(host):\(port) (attempt \(reconnectAttempt + 1))")
                    self.status = "connecting"
                    self.service?.emitAllStatus()

                    // TLS connection (trust all certs, matching Android's clientTrustAll)
                    let tlsOpts = NWProtocolTLS.Options()
                    sec_protocol_options_set_verify_block(tlsOpts.securityProtocolOptions) { _, _, completion in
                        completion(true) // trust all
                    }
                    let params = NWParameters(tls: tlsOpts)
                    let endpoint = NWEndpoint.hostPort(
                        host: NWEndpoint.Host(host),
                        port: NWEndpoint.Port(rawValue: UInt16(port))!)
                    let tlsConn = NWConnection(to: endpoint, using: params)
                    self.tlsConnection = tlsConn

                    let connectSem = DispatchSemaphore(value: 0)
                    var connectError: NWError?

                    tlsConn.stateUpdateHandler = { state in
                        switch state {
                        case .ready:
                            connectSem.signal()
                        case .failed(let err):
                            connectError = err
                            connectSem.signal()
                        default:
                            break
                        }
                    }
                    tlsConn.start(queue: queue)
                    _ = connectSem.wait(timeout: .now() + .seconds(15))

                    if let err = connectError {
                        throw err
                    }

                    print("[ClientRunner] TLS connected")

                    let mux = MuxSession(connection: tlsConn, password: password)
                    self.session = mux

                    mux.sendAuth(password: password, clientId: clientId)

                    // Wait for auth response
                    let authTimeout: TimeInterval = 30.0
                    let authDeadline = Date().addingTimeInterval(authTimeout)
                    var authenticated = false
                    while self.running && Date() < authDeadline {
                        guard let frame = mux.readFrame() else { break }
                        if frame.type == MuxSession.TYPE_AUTH_RES {
                            authenticated = frame.payload.count > 0 && frame.payload[0] == 1
                            break
                        }
                    }

                    guard authenticated else {
                        throw NSError(domain: "BiTunnel", code: 2, userInfo: [NSLocalizedDescriptionKey: "Authentication failed"])
                    }

                    print("[ClientRunner] \(clientId) authenticated")
                    self.status = "connected"
                    self.service?.emitAllStatus()
                    self.error = nil
                    reconnectAttempt = 0

                    // Start local SOCKS5 proxy
                    let p = Socks5Proxy(
                        port: proxyPort,
                        onForwardRequest: { [weak self] targetHost, targetPort, clientConn in
                            guard let self = self, let mux = self.session else { return }
                            TunnelService.handleProxyRequest(mux: mux, targetHost: targetHost, targetPort: targetPort, clientConn: clientConn)
                        },
                        rules: rules,
                        defaultAction: "forward"
                    )
                    self.proxy = p
                    p.start()

                    // Start mux reader
                    mux.startReader { [weak self] frame in
                        guard let self = self else { return }
                        // Handle incoming CREATE from server (server PF -> local target)
                        if frame.type == MuxSession.TYPE_CREATE {
                            self.handleIncomingCreate(mux, frame: frame)
                        }
                    }

                    // Restart port forwards
                    if let pfRules = self.config["portForwards"] as? [[String: Any]] {
                        for pf in pfRules {
                            if pf["enabled"] as? Bool == true {
                                self.service?.startPortForward(instanceId: self.id, rule: pf)
                            }
                        }
                    }

                    // Wait for disconnect
                    while self.running {
                        Thread.sleep(forTimeInterval: 1.0)
                        if mux.isClosed {
                            print("[ClientRunner] \(clientId) connection lost")
                            throw NSError(domain: "BiTunnel", code: 3, userInfo: [NSLocalizedDescriptionKey: "Connection lost"])
                        }
                    }
                    break

                } catch {
                    guard self.running else { break }
                    reconnectAttempt += 1
                    print("[ClientRunner] error: \(error.localizedDescription) (attempt \(reconnectAttempt))")

                    if self.running {
                        self.status = "reconnecting"
                        self.error = nil
                        self.service?.emitAllStatus()
                    }

                    self.proxy?.stop()
                    self.proxy = nil
                    self.session?.close()
                    self.session = nil
                    self.tlsConnection?.cancel()
                    self.tlsConnection = nil

                    // Stop stale port forwards
                    self.service?.stopAllPortForwards(instanceId: self.id)

                    // Exponential backoff
                    let delay = min(1.0 * pow(2.0, Double(reconnectAttempt - 1)), 30.0)
                    let deadline = Date().addingTimeInterval(delay)
                    while self.running && Date() < deadline {
                        Thread.sleep(forTimeInterval: min(1.0, deadline.timeIntervalSinceNow))
                    }
                }
            }

            // Cleanup
            self.running = false
            self.status = "disconnected"
            self.proxy?.stop()
            self.proxy = nil
            self.session?.close()
            self.session = nil
            self.tlsConnection?.cancel()
            self.tlsConnection = nil
            self.service?.stopAllPortForwards(instanceId: self.id)
            self.service?.clientRunners.removeValue(forKey: self.id)
            self.service?.emitAllStatus()
        }
    }

    func stop() {
        running = false
        proxy?.stop()
        proxy = nil
        session?.close()
        session = nil
        tlsConnection?.cancel()
        tlsConnection = nil
    }

    private func handleIncomingCreate(_ mux: MuxSession, frame: MuxFrame) {
        let metaStr = String(data: frame.payload, encoding: .utf8) ?? ""
        guard let json = try? JSONSerialization.jsonObject(with: metaStr.data(using: .utf8)!) as? [String: Any] else {
            mux.sendCreateAck(channelId: frame.channelId, success: false)
            return
        }
        let host = json["host"] as? String ?? ""
        let port = json["port"] as? Int ?? 0
        guard !host.isEmpty, port > 0 else {
            mux.sendCreateAck(channelId: frame.channelId, success: false)
            return
        }
        let queue = mux.subscribeChannel(frame.channelId)
        let relayQueue = DispatchQueue(label: "client-relay-\(frame.channelId)")
        relayQueue.async { [weak self] in
            self?.connectTarget(mux: mux, channelId: frame.channelId, host: host, port: port, queue: queue)
        }
    }

    private func connectTarget(mux: MuxSession, channelId: UInt32, host: String, port: Int, queue: BlockingQueue<MuxFrame>) {
        var remote: NWConnection? = nil
        let sem = DispatchSemaphore(value: 0)
        var connectError: NWError?

        let params = NWParameters.tcp
        let remoteConn = NWConnection(to: NWEndpoint.hostPort(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: UInt16(port))!
        ), using: params)
        remote = remoteConn

        remoteConn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                print("[ClientRunner] connected target \(host):\(port)")
                sem.signal()
            case .failed(let error):
                print("[ClientRunner] target connect error: \(error)")
                connectError = error
                sem.signal()
            default:
                break
            }
        }
        remoteConn.start(queue: DispatchQueue(label: "client-target-connect-\(channelId)"))

        let waitResult = sem.wait(timeout: .now() + .seconds(15))
        if waitResult == .timedOut || connectError != nil {
            mux.sendCreateAck(channelId: channelId, success: false)
            remoteConn.cancel()
            return
        }

        mux.sendCreateAck(channelId: channelId, success: true)

        let writeQueue = DispatchQueue(label: "client-write-target-\(channelId)")
        writeQueue.async {
            while !mux.isClosed {
                guard let frame = queue.poll(timeout: .now() + .milliseconds(500)) else { continue }
                switch frame.type {
                case MuxSession.TYPE_DATA:
                    remoteConn.send(content: frame.payload, completion: .contentProcessed { _ in })
                case MuxSession.TYPE_CLOSE:
                    remoteConn.cancel()
                    return
                default:
                    break
                }
            }
        }

        func readRemote() {
            guard !mux.isClosed else {
                mux.sendClose(channelId: channelId)
                mux.unsubscribeChannel(channelId)
                remoteConn.cancel()
                return
            }
            remoteConn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, error in
                guard let d = data, !d.isEmpty, error == nil else {
                    mux.sendClose(channelId: channelId)
                    mux.unsubscribeChannel(channelId)
                    remoteConn.cancel()
                    return
                }
                mux.sendData(channelId: channelId, data: d)
                readRemote()
            }
        }
        readRemote()
    }

    private func parseRules(_ raw: Any?) -> [ProxyRule] {
        guard let list = raw as? [[String: Any]] else { return [] }
        return list.compactMap { r in
            guard let matchType = r["matchType"] as? String else { return nil }
            return ProxyRule(
                matchType: matchType,
                matchValue: r["matchValue"] as? String ?? "",
                enabled: r["enabled"] as? Bool ?? true,
                action: r["action"] as? String ?? "forward"
            )
        }
    }
}

// MARK: - ServerRunner

class ServerRunner {
    let id: String
    private let config: [String: Any]
    weak var service: TunnelService?

    private(set) var running = false
    private(set) var connectedClients: [String] = []
    private(set) var error: String?

    private var tunnelServer: TunnelServer?
    private var workerQueue: DispatchQueue?

    init(service: TunnelService, config: [String: Any]) {
        self.service = service
        self.config = config
        self.id = config["id"] as? String ?? UUID().uuidString
    }

    func start() {
        running = true
        let queue = DispatchQueue(label: "server-runner-\(id)")
        workerQueue = queue
        queue.async { [weak self] in
            guard let self = self else { return }
            do {
                let listenPort = self.config["listenPort"] as? Int ?? 33891
                let password = self.config["password"] as? String ?? ""
                let sni = self.config["sni"] as? String ?? "mail.qq.com"
                let bindIp = self.config["bindIp"] as? String ?? "127.0.0.1"

                let server = TunnelServer(
                    listenPort: listenPort,
                    password: password,
                    bindIp: bindIp,
                    sni: sni,
                    onClientConnect: { [weak self] clientId in
                        guard let self = self else { return }
                        self.connectedClients.append(clientId)
                        self.service?.emitAllStatus()
                    },
                    onClientDisconnect: { [weak self] clientId in
                        guard let self = self else { return }
                        self.connectedClients.removeAll { $0 == clientId }
                        self.service?.emitAllStatus()
                    }
                )
                self.tunnelServer = server
                server.start(onError: { [weak self] msg in
                    guard let self = self, self.running else { return }
                    print("[ServerRunner] error: \(msg)")
                    self.error = msg
                    self.service?.emitAllStatus()
                })

                while self.running && server.running {
                    Thread.sleep(forTimeInterval: 1.0)
                }
            } catch {
                print("[ServerRunner] error: \(error.localizedDescription)")
                if self.running {
                    self.error = error.localizedDescription
                }
            }
            let failed = self.running
            self.running = false
            self.tunnelServer?.stop()
            self.tunnelServer = nil
            if !failed {
                // 启动失败时保留 runner，让 UI 能看到错误信息；仅用户主动停止才移除
                if let current = self.service?.serverRunners[self.id], current === self {
                    self.service?.serverRunners.removeValue(forKey: self.id)
                }
            }
            self.service?.emitAllStatus()
        }
    }

    func stop() {
        running = false
        tunnelServer?.stop()
        tunnelServer = nil
    }
}

// MARK: - ProxyRunner

class ProxyRunner {
    let id: String
    private let config: [String: Any]
    weak var service: TunnelService?

    private(set) var running = false
    private(set) var error: String?
    private var proxy: Socks5Proxy?
    private var workerQueue: DispatchQueue?

    init(service: TunnelService, config: [String: Any]) {
        self.service = service
        self.config = config
        self.id = config["id"] as? String ?? UUID().uuidString
    }

    func start() {
        running = true
        let queue = DispatchQueue(label: "proxy-runner-\(id)")
        workerQueue = queue
        queue.async { [weak self] in
            guard let self = self else { return }
            do {
                let listenPort = self.config["listenPort"] as? Int ?? 1080
                let accounts = self.parseAccounts(self.config["accounts"])

                let p = Socks5Proxy(
                    port: listenPort,
                    accounts: accounts,
                    onForwardRequest: { _, _, _ in },
                    defaultAction: "direct",
                    onError: { [weak self] msg in
                        guard let self = self else { return }
                        self.error = msg
                        self.service?.emitAllStatus()
                    }
                )
                self.proxy = p
                p.start()

                while self.running && p.running {
                    Thread.sleep(forTimeInterval: 1.0)
                }
            } catch {
                print("[ProxyRunner] error: \(error.localizedDescription)")
                if self.running {
                    self.error = error.localizedDescription
                }
            }
            let failed = self.running
            self.running = false
            self.proxy?.stop()
            self.proxy = nil
            if !failed {
                // 启动失败时保留 runner，让 UI 能看到错误信息；仅用户主动停止才移除
                // 身份校验防止旧 runner 线程误删同 id 的新 runner
                if let current = self.service?.proxyRunners[self.id], current === self {
                    self.service?.proxyRunners.removeValue(forKey: self.id)
                }
            }
            self.service?.emitAllStatus()
        }
    }

    func stop() {
        running = false
        proxy?.stop()
        proxy = nil
    }

    private func parseAccounts(_ raw: Any?) -> [ProxyAccount] {
        guard let list = raw as? [[String: Any]] else { return [] }
        return list.map { r in
            ProxyAccount(
                username: r["username"] as? String ?? "",
                password: r["password"] as? String ?? "",
                enabled: r["enabled"] as? Bool ?? true
            )
        }
    }
}

// MARK: - Port Forward Runner

struct PfRunnerInfo {
    let listener: NWListener
    func stop() {
        listener.cancel()
    }
}

// MARK: - TunnelService extension for port forward cleanup

extension TunnelService {
    func stopAllPortForwards(instanceId: String) {
        runnersLock.lock()
        let runners = pfRunners.removeValue(forKey: instanceId)
        runnersLock.unlock()
        runners?.values.forEach { $0.stop() }
    }
}
