import Foundation
import Network

class TunnelServer {
    private let listenPort: Int
    private let password: String
    private let bindIp: String
    private let sni: String
    private let onClientConnect: ((String) -> Void)?
    private let onClientDisconnect: ((String) -> Void)?

    private var listener: NWListener?
    private var sessions: [String: MuxSession] = [:]
    private let sessionsLock = NSLock()
    private var channelIdCounter: UInt32 = 1
    private let serverQueue = DispatchQueue(label: "tunnel-server-queue")
    private let acceptQueue = DispatchQueue(label: "tunnel-server-accept")
    private(set) var running = false

    init(listenPort: Int,
         password: String,
         bindIp: String = "127.0.0.1",
         sni: String = "mail.qq.com",
         onClientConnect: ((String) -> Void)? = nil,
         onClientDisconnect: ((String) -> Void)? = nil) {
        self.listenPort = listenPort
        self.password = password
        self.bindIp = bindIp
        self.sni = sni
        self.onClientConnect = onClientConnect
        self.onClientDisconnect = onClientDisconnect
    }

    func start(onError: ((String) -> Void)? = nil) {
        running = true
        serverQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let params = try self.createTLSParams()
                let port = NWEndpoint.Port(rawValue: UInt16(self.listenPort))!
                let listener = try NWListener(using: params, on: port)
                self.listener = listener

                listener.newConnectionHandler = { [weak self] conn in
                    self?.handleClient(conn)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    guard let self = self else { return }
                    switch state {
                    case .ready:
                        print("[TunnelServer] listening on port \(self.listenPort)")
                    case .failed(let error):
                        print("[TunnelServer] listener error: \(error)")
                        self.running = false
                        onError?(error.localizedDescription)
                    default:
                        break
                    }
                }
                listener.start(queue: self.acceptQueue)

                while self.running {
                    Thread.sleep(forTimeInterval: 1.0)
                }
            } catch {
                print("[TunnelServer] start error: \(error)")
                self.running = false
                onError?(error.localizedDescription)
            }
        }
    }

    func stop() {
        running = false
        sessionsLock.lock()
        for (_, session) in sessions {
            session.close()
        }
        sessions.removeAll()
        sessionsLock.unlock()
        listener?.cancel()
        listener = nil
        print("[TunnelServer] stopped")
    }

    private func handleClient(_ conn: NWConnection) {
        conn.start(queue: acceptQueue)
        print("[TunnelServer] new client connection")

        let mux = MuxSession(connection: conn, password: password)

        guard let clientId = authenticateClient(mux) else {
            conn.cancel()
            return
        }

        sessionsLock.lock()
        sessions[clientId] = mux
        sessionsLock.unlock()
        onClientConnect?(clientId)
        print("[TunnelServer] client connected: \(clientId)")

        mux.startReader { [weak self] frame in
            self?.handleControlFrame(mux, frame: frame)
        }

        let pollQueue = DispatchQueue(label: "server-poll-\(clientId)")
        pollQueue.async { [weak self] in
            while !mux.isClosed && (self?.running ?? false) {
                Thread.sleep(forTimeInterval: 1.0)
            }
            guard let self = self else { return }
            self.sessionsLock.lock()
            // 仅当 sessions[clientId] 仍是本连接时才移除，防止同 clientId 新连接覆盖后被旧连接误删
            guard self.sessions[clientId] === mux else {
                self.sessionsLock.unlock()
                return
            }
            self.sessions.removeValue(forKey: clientId)
            self.sessionsLock.unlock()
            self.onClientDisconnect?(clientId)
            print("[TunnelServer] client disconnected: \(clientId)")
        }
    }

    private func authenticateClient(_ mux: MuxSession) -> String? {
        let timeout: TimeInterval = 30.0
        let deadline = Date().addingTimeInterval(timeout)

        while Date() < deadline {
            guard let frame = mux.readFrame() else { return nil }
            if frame.type == MuxSession.TYPE_AUTH {
                let metaStr = String(data: frame.payload, encoding: .utf8) ?? ""
                guard let json = try? JSONSerialization.jsonObject(with: metaStr.data(using: .utf8)!) as? [String: Any] else {
                    mux.sendAuthRes(false)
                    return nil
                }
                let clientPassword = json["password"] as? String ?? ""
                let clientId = json["clientId"] as? String ?? ""
                if clientPassword == password && !clientId.isEmpty {
                    mux.sendAuthRes(true)
                    return clientId
                }
                mux.sendAuthRes(false)
                return nil
            }
        }
        return nil
    }

    private func handleControlFrame(_ mux: MuxSession, frame: MuxFrame) {
        switch frame.type {
        case MuxSession.TYPE_CREATE:
            let metaStr = String(data: frame.payload, encoding: .utf8) ?? ""
            guard let json = try? JSONSerialization.jsonObject(with: metaStr.data(using: .utf8)!) as? [String: Any] else { return }
            let host = json["host"] as? String ?? ""
            let port = json["port"] as? Int ?? 0
            guard !host.isEmpty, port > 0 else { return }
            let queue = mux.subscribeChannel(frame.channelId)
            let relayQueue = DispatchQueue(label: "relay-\(frame.channelId)")
            relayQueue.async { [weak self] in
                self?.connectTarget(mux: mux, channelId: frame.channelId, host: host, port: port, queue: queue)
            }
        default:
            break
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
                print("[TunnelServer] connected target \(host):\(port)")
                sem.signal()
            case .failed(let error):
                print("[TunnelServer] target connect error: \(error)")
                connectError = error
                sem.signal()
            default:
                break
            }
        }
        remoteConn.start(queue: DispatchQueue(label: "target-connect-\(channelId)"))

        let waitResult = sem.wait(timeout: .now() + .seconds(15))
        if waitResult == .timedOut || connectError != nil {
            mux.sendCreateAck(channelId: channelId, success: false)
            remoteConn.cancel()
            return
        }

        mux.sendCreateAck(channelId: channelId, success: true)

        let writeQueue = DispatchQueue(label: "write-target-\(channelId)")
        writeQueue.async {
            while mux.isAuthenticated && !mux.isClosed {
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
            guard mux.isAuthenticated && !mux.isClosed else {
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

    private func createTLSParams() throws -> NWParameters {
        guard let certURL = Bundle.main.url(forResource: "tunnel_cert", withExtension: "pem"),
              let keyURL = Bundle.main.url(forResource: "tunnel_key", withExtension: "pem") else {
            throw NSError(domain: "BiTunnel", code: 1001, userInfo: [NSLocalizedDescriptionKey: "证书缺失，隧道无法启动"])
        }
        guard let certPem = try? String(contentsOf: certURL, encoding: .utf8),
              let keyPem = try? String(contentsOf: keyURL, encoding: .utf8) else {
            throw NSError(domain: "BiTunnel", code: 1002, userInfo: [NSLocalizedDescriptionKey: "证书读取失败，隧道无法启动"])
        }

        let certDer = parsePEM(certPem)
        let keyDer = parsePEM(keyPem)
        guard !certDer.isEmpty, !keyDer.isEmpty else {
            throw NSError(domain: "BiTunnel", code: 1003, userInfo: [NSLocalizedDescriptionKey: "证书解析失败，隧道无法启动"])
        }

        guard let cert = SecCertificateCreateWithData(nil, certDer as CFData) else {
            throw NSError(domain: "BiTunnel", code: 1004, userInfo: [NSLocalizedDescriptionKey: "证书无效，隧道无法启动"])
        }

        let keyAttrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateWithData(keyDer as CFData, keyAttrs as CFDictionary, &error) else {
            throw NSError(domain: "BiTunnel", code: 1005, userInfo: [NSLocalizedDescriptionKey: "私钥无效，隧道无法启动"])
        }

        // Add to keychain temporarily to create identity
        let label = "com.bitunnel.server.\(UUID().uuidString)"
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassCertificate,
            kSecValueRef as String: cert,
            kSecAttrLabel as String: label,
        ]
        SecItemAdd(addQuery as CFDictionary, nil)

        let keyAddQuery: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecValueRef as String: key,
            kSecAttrLabel as String: label,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ]
        SecItemAdd(keyAddQuery as CFDictionary, nil)

        // Query identity
        let idQuery: [String: Any] = [
            kSecClass as String: kSecClassIdentity,
            kSecAttrLabel as String: label,
            kSecReturnRef as String: true,
        ]
        var identityRef: CFTypeRef?
        let status = SecItemCopyMatching(idQuery as CFDictionary, &identityRef)

        // Clean up keychain items
        SecItemDelete(addQuery as CFDictionary)
        SecItemDelete(keyAddQuery as CFDictionary)

        guard status == errSecSuccess, let identity = identityRef as? SecIdentity else {
            throw NSError(domain: "BiTunnel", code: 1006, userInfo: [NSLocalizedDescriptionKey: "证书身份创建失败，隧道无法启动"])
        }

        let tlsOpts = NWProtocolTLS.Options()
        let secIdentity = sec_identity_create(identity)
        sec_protocol_options_set_local_identity(tlsOpts.securityProtocolOptions, secIdentity)
        print("[TunnelServer] TLS configured with server identity")
        return NWParameters(tls: tlsOpts)
    }

    private func parsePEM(_ pem: String) -> Data {
        let lines = pem.components(separatedBy: "\n")
            .filter { !$0.hasPrefix("-----") }
        let b64 = lines.joined()
        return Data(base64Encoded: b64) ?? Data()
    }
}
