import Foundation
import AVFoundation
import UIKit
import Network
import CryptoKit

class TunnelService: NSObject {
    static var statusCallback: (([String: Any]) -> Void)?

    private var connection: NWConnection?
    private var audioPlayer: AVAudioPlayer?
    private var proxyListener: NWListener?
    @Published private(set) var state = "disconnected"
    private(set) var bytesSent: Int64 = 0
    private(set) var bytesReceived: Int64 = 0
    private(set) var connectedDuration: Int64 = 0
    private var connectedSince: Date?

    var statusCallback: (([String: Any]) -> Void)?

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var pendingData = Data()
    private var encryptionKey: SymmetricKey?

    private let headerSize = 9
    private let aesIVLen = 12
    private let aesTagLen = 16

    override init() {
        super.init()
        setupAudio()
        observeLifecycle()
    }

    private func setupAudio() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
    }

    private func observeLifecycle() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(willEnterForeground),
            name: UIApplication.willEnterForegroundNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(didEnterBackground),
            name: UIApplication.didEnterBackgroundNotification,
            object: nil
        )
    }

    @objc private func willEnterForeground() {
        ensureAudioSession()
    }

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
        if type == .ended {
            startSilentAudio()
        }
    }

    private func startSilentAudio() {
        ensureAudioSession()
        guard let path = Bundle.main.path(forResource: "silence", ofType: "mp3") else {
            print("[BiTunnel] silence.mp3 not found in bundle")
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

    func connect(config: [String: Any]) {
        let host = config["tunnelHost"] as? String ?? ""
        let port = (config["tunnelPort"] as? NSNumber)?.intValue ?? 33891
        let password = config["password"] as? String ?? ""
        let clientId = config["clientId"] as? String ?? "mobile-1"
        proxyPort = (config["localProxyPort"] as? NSNumber)?.intValue ?? 1080

        guard !host.isEmpty else {
            state = "failed"
            emitStatus()
            return
        }

        if !password.isEmpty {
            let keyData = SHA256.hash(data: password.data(using: .utf8)!)
            encryptionKey = SymmetricKey(data: keyData)
        }

        state = "connecting"
        emitStatus()

        startBackgroundTask()
        startSilentAudio()

        let params = NWParameters.tls
        let endpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host(host),
            port: NWEndpoint.Port(rawValue: UInt16(port))!
        )

        let conn = NWConnection(to: endpoint, using: params)
        self.connection = conn

        conn.stateUpdateHandler = { [weak self] newState in
            guard let self = self else { return }
            switch newState {
            case .ready:
                print("[BiTunnel] TLS connected")
                self.sendAuth(password: password, clientId: clientId)
            case .failed(let error):
                print("[BiTunnel] Connection failed: \(error)")
                self.state = "failed"
                self.emitStatus()
                self.cleanup()
            case .cancelled:
                self.state = "disconnected"
                self.emitStatus()
                self.cleanup()
            default:
                break
            }
        }

        conn.start(queue: .global())
    }

    private func sendAuth(password: String, clientId: String) {
        guard let conn = connection else { return }

        let payload = "{\"password\":\"\(password)\",\"clientId\":\"\(clientId)\"}"
        guard let payloadData = payload.data(using: .utf8) else { return }

        let frame = buildFrame(type: MuxTypes.TYPE_AUTH, channelId: 0, payload: payloadData)
        conn.send(content: frame, completion: .contentProcessed { [weak self] error in
            guard let self = self else { return }
            if error != nil {
                self.state = "failed"
                self.emitStatus()
                return
            }
            self.readAuthResponse()
        })
    }

    private func readAuthResponse() {
        readHeader { [weak self] header in
            guard let self = self, let hdr = header else {
                self?.state = "failed"
                self?.emitStatus()
                return
            }
            let type = Int(hdr[0])
            let payloadLen = hdr.withUnsafeBytes { $0.load(fromByteOffset: 5, as: UInt32.self) }.bigEndian

            guard type == MuxTypes.TYPE_AUTH_RES, payloadLen > 0 else {
                self.state = "failed"
                self.emitStatus()
                return
            }

            self.readPayload(length: Int(payloadLen)) { payload in
                guard let data = payload, data.first == 1 else {
                    self.state = "failed"
                    self.emitStatus()
                    return
                }
                print("[BiTunnel] Auth OK")
                self.state = "connected"
                self.connectedSince = Date()
                self.emitStatus()
                self.startLocalProxy(port: proxyPort)
                self.readLoop()
            }
        }
    }

    private var proxyPort = 1080

    private func startLocalProxy(port: Int) {
        proxyPort = port
        do {
            let params = NWParameters.tcp
            proxyListener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: UInt16(port))!)
            proxyListener?.newConnectionHandler = { [weak self] conn in
                self?.handleSocks5(conn)
            }
            proxyListener?.start(queue: .global())
            print("[BiTunnel] SOCKS5 proxy on 127.0.0.1:\(port)")
        } catch {
            print("[BiTunnel] Proxy error: \(error)")
        }
    }

    private func handleSocks5(_ conn: NWConnection) {
        conn.start(queue: .global())
        conn.receive(minimumIncompleteLength: 3, maximumLength: 3) { [weak self] data, _, _, _ in
            guard let d = data, d.count >= 3, d[0] == 5 else { return }
            // No auth
            conn.send(content: Data([0x05, 0x00]), completion: .contentProcessed { _ in
                self?.readSocks5Request(conn)
            })
        }
    }

    private func readSocks5Request(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 4, maximumLength: 260) { [weak self] data, _, _, _ in
            guard let self = self, let buf = data, buf.count >= 4 else { return }
            let atyp = buf[3]
            var host = ""
            var port = 0

            switch atyp {
            case 1: // IPv4
                guard buf.count >= 10 else { return }
                host = (4...7).map { "\(buf[$0])" }.joined(separator: ".")
                port = (Int(buf[8]) << 8) | Int(buf[9])
            case 3: // Domain
                let len = Int(buf[4])
                guard buf.count >= 5 + len + 2 else { return }
                host = String(data: buf[5..<(5+len)], encoding: .utf8) ?? ""
                port = (Int(buf[5+len]) << 8) | Int(buf[6+len])
            case 4: // IPv6
                guard buf.count >= 22 else { return }
                let parts = stride(from: 0, to: 16, by: 2).map { String(format: "%02x%02x", buf[4+$0], buf[5+$0]) }
                host = parts.joined(separator: ":")
                port = (Int(buf[20]) << 8) | Int(buf[21])
            default: return
            }

            conn.send(content: Data([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]), completion: .contentProcessed { _ in
                self.forwardOverTunnel(conn, host: host, port: port)
            })
        }
    }

    private var nextChannelId: UInt32 = 1
    private var channels: [UInt32: NWConnection] = [:]

    private func forwardOverTunnel(_ conn: NWConnection, host: String, port: Int) {
        guard let tlsConn = connection else { return }
        let channelId = nextChannelId
        nextChannelId += 2
        channels[channelId] = conn

        let meta = "{\"type\":\"forward\",\"host\":\"\(host)\",\"port\":\(port)}"
        guard let metaData = meta.data(using: .utf8) else { return }

        let frame = buildFrame(type: MuxTypes.TYPE_CREATE, channelId: channelId, payload: metaData)
        tlsConn.send(content: frame, completion: .contentProcessed(nil))

        // Read from local and send over tunnel
        readLocalAndSend(conn, channelId: channelId)
    }

    private func readLocalAndSend(_ conn: NWConnection, channelId: UInt32) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self = self, let tlsConn = self.connection else { return }

            if let d = data, !d.isEmpty {
                let frame = self.buildFrame(type: MuxTypes.TYPE_DATA, channelId: channelId, payload: d)
                tlsConn.send(content: frame, completion: .contentProcessed(nil))
                self.bytesSent += Int64(d.count)
                self.emitStatus()
                self.readLocalAndSend(conn, channelId: channelId)
            } else if error != nil {
                let closeFrame = self.buildFrame(type: MuxTypes.TYPE_CLOSE, channelId: channelId, payload: Data())
                tlsConn.send(content: closeFrame, completion: .contentProcessed(nil))
                self.channels.removeValue(forKey: channelId)
            }
        }
    }

    private func readLoop() {
        readHeader { [weak self] header in
            guard let self = self, let hdr = header else {
                self?.state = "disconnected"
                self?.emitStatus()
                return
            }

            let type = Int(hdr[0])
            let channelId = hdr.withUnsafeBytes { $0.load(fromByteOffset: 1, as: UInt32.self) }.bigEndian
            let payloadLen = hdr.withUnsafeBytes { $0.load(fromByteOffset: 5, as: UInt32.self) }.bigEndian

            self.readPayload(length: Int(payloadLen)) { payload in
                guard let data = payload else {
                    self.state = "disconnected"
                    self.emitStatus()
                    return
                }

                if type == MuxTypes.TYPE_DATA {
                    if let localConn = self.channels[channelId] {
                        localConn.send(content: data, completion: .contentProcessed(nil))
                        self.bytesReceived += Int64(data.count)
                        self.emitStatus()
                    }
                } else if type == MuxTypes.TYPE_CLOSE {
                    self.channels[channelId]?.cancel()
                    self.channels.removeValue(forKey: channelId)
                }

                self.readLoop()
            }
        }
    }

    private func readHeader(completion: @escaping (Data?) -> Void) {
        connection?.receive(minimumIncompleteLength: headerSize, maximumLength: headerSize) { data, _, _, error in
            completion(data)
        }
    }

    private func readPayload(length: Int, completion: @escaping (Data?) -> Void) {
        guard length > 0 else { completion(Data()); return }
        connection?.receive(minimumIncompleteLength: length, maximumLength: length) { data, _, _, _ in
            completion(data)
        }
    }

    private func buildFrame(type: Int, channelId: UInt32, payload: Data) -> Data {
        let encrypted = encrypt(payload)
        var header = Data(count: headerSize)
        header[0] = UInt8(type)
        header.withUnsafeMutableBytes { ptr in
            ptr.storeBytes(of: channelId.bigEndian, toByteOffset: 1, as: UInt32.self)
            ptr.storeBytes(of: UInt32(encrypted.count).bigEndian, toByteOffset: 5, as: UInt32.self)
        }
        return header + encrypted
    }

    private func encrypt(_ plaintext: Data) -> Data {
        guard let key = encryptionKey else { return plaintext }
        do {
            let sealedBox = try AES.GCM.seal(plaintext, using: key)
            return sealedBox.nonce + sealedBox.ciphertext + sealedBox.tag
        } catch {
            return plaintext
        }
    }

    private func decrypt(_ data: Data) -> Data {
        guard let key = encryptionKey else { return data }
        guard data.count > aesIVLen + aesTagLen else { return data }
        do {
            let nonce = try AES.GCM.Nonce(data: data.prefix(aesIVLen))
            let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: data.dropFirst(aesIVLen).dropLast(aesTagLen), tag: data.suffix(aesTagLen))
            return try AES.GCM.open(box, using: key)
        } catch {
            return data
        }
    }

    func disconnect() {
        cleanup()
        state = "disconnected"
        connectedSince = nil
        emitStatus()
    }

    private func cleanup() {
        stopSilentAudio()
        endBackgroundTask()
        for (_, conn) in channels { conn.cancel() }
        channels.removeAll()
        proxyListener?.cancel()
        proxyListener = nil
        connection?.cancel()
        connection = nil
    }

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

    private func emitStatus() {
        let duration = connectedSince.map { Int64(Date().timeIntervalSince($0) * 1000) } ?? 0
        let status: [String: Any] = [
            "state": state,
            "bytesSent": bytesSent,
            "bytesReceived": bytesReceived,
            "connectedDuration": duration,
        ]
        statusCallback?(status)
        Self.statusCallback?(status)
    }
}
