import Foundation
import Network

struct ProxyRule {
    let matchType: String
    let matchValue: String
    let enabled: Bool
    let action: String

    init(matchType: String, matchValue: String, enabled: Bool = true, action: String = "forward") {
        self.matchType = matchType
        self.matchValue = matchValue
        self.enabled = enabled
        self.action = action
    }
}

struct ProxyAccount {
    let username: String
    let password: String
    let enabled: Bool

    init(username: String, password: String, enabled: Bool = true) {
        self.username = username
        self.password = password
        self.enabled = enabled
    }
}

class Socks5Proxy {
    private let port: Int
    private let accounts: [ProxyAccount]
    private let onForwardRequest: (String, Int, NWConnection) -> Void
    private let onDirectRequest: ((String, Int, NWConnection) -> Void)?
    private let rules: [ProxyRule]
    private let defaultAction: String
    private let onError: ((String) -> Void)?

    private var listener: NWListener?
    private var activeConns: [NWConnection] = []
    private let proxyQueue = DispatchQueue(label: "socks5-proxy-queue")
    private let acceptQueue = DispatchQueue(label: "socks5-accept-queue")
    private(set) var running = false

    private var useAuth: Bool {
        accounts.contains { !$0.username.isEmpty }
    }

    init(port: Int,
         accounts: [ProxyAccount] = [],
         onForwardRequest: @escaping (String, Int, NWConnection) -> Void,
         onDirectRequest: ((String, Int, NWConnection) -> Void)? = nil,
         rules: [ProxyRule] = [],
         defaultAction: String = "forward",
         onError: ((String) -> Void)? = nil) {
        self.port = port
        self.accounts = accounts
        self.onForwardRequest = onForwardRequest
        self.onDirectRequest = onDirectRequest
        self.rules = rules
        self.defaultAction = defaultAction
        self.onError = onError
    }

    func start() {
        running = true
        print("[Socks5Proxy] start port=\(port)")
        proxyQueue.async { [weak self] in
            guard let self = self else { return }
            do {
                let params = NWParameters.tcp
                let listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: UInt16(self.port))!)
                self.listener = listener
                listener.newConnectionHandler = { [weak self] conn in
                    self?.handleClient(conn)
                }
                listener.stateUpdateHandler = { [weak self] state in
                    guard let self = self else { return }
                    switch state {
                    case .ready:
                        print("[Socks5Proxy] bound on 127.0.0.1:\(self.port)")
                    case .failed(let error):
                        print("[Socks5Proxy] listener error: \(error)")
                        self.onError?(error.localizedDescription)
                        self.running = false
                    default:
                        break
                    }
                }
                listener.start(queue: self.acceptQueue)
            } catch {
                print("[Socks5Proxy] start error: \(error)")
                self.onError?(error.localizedDescription)
                self.running = false
            }
        }
    }

    func stop() {
        running = false
        listener?.cancel()
        listener = nil
        print("[Socks5Proxy] stopped")
    }

    private func handleClient(_ conn: NWConnection) {
        conn.start(queue: acceptQueue)
        print("[Socks5Proxy] new connection")

        // Read first byte to detect protocol
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self] data, _, _, error in
            guard let self = self, let d = data, d.count == 1, error == nil else {
                conn.cancel()
                return
            }
            let firstByte = Int(d[0])
            print("[Socks5Proxy] firstByte=\(firstByte)")
            if firstByte == 0x05 {
                // The first byte is already consumed. Read remaining of method negotiation
                // SOCKS5 needs at least 2 more bytes for nmethods + methods
                conn.receive(minimumIncompleteLength: 2, maximumLength: 257) { [weak self] data2, _, _, error2 in
                    guard let self = self, let d2 = data2, d2.count >= 2, error2 == nil else {
                        conn.cancel()
                        return
                    }
                    var fullBuf = Data([0x05])
                    fullBuf.append(d2)
                    self.handleSocks5(conn, initialData: fullBuf)
                }
            } else if HTTP_PROTO_BYTES.contains(UInt8(firstByte)) {
                conn.receive(minimumIncompleteLength: 3, maximumLength: 8191) { [weak self] data2, _, _, error2 in
                    guard let self = self, let d2 = data2, d2.count > 0, error2 == nil else {
                        conn.cancel()
                        return
                    }
                    var fullBuf = Data([UInt8(firstByte)])
                    fullBuf.append(d2)
                    self.handleHttp(conn, initialData: fullBuf)
                }
            } else {
                conn.cancel()
            }
        }
    }

    // MARK: - SOCKS5 Handler

    private func handleSocks5(_ conn: NWConnection, initialData: Data) {
        print("[Socks5Proxy] handleSocks5")
        let buf = initialData
        guard buf.count >= 3, buf[0] == 0x05 else {
            conn.cancel()
            return
        }
        let nmethods = Int(buf[1])
        guard buf.count >= 2 + nmethods else {
            conn.cancel()
            return
        }
        let methods = (2..<(2 + nmethods)).map { Int(buf[$0]) }
        print("[Socks5Proxy] nmethods=\(nmethods) methods=\(methods) useAuth=\(useAuth)")

        var reply = Data()
        if useAuth {
            if methods.contains(0x02) {
                reply = Data([0x05, 0x02])
                sendAndWait(conn, data: reply)
                guard let authData = readBytesSync(conn, min: 5, max: 260) else { conn.cancel(); return }
                guard authData.count >= 5, authData[0] == 0x01 else {
                    _ = sendAndWait(conn, data: Data([0x01, 0x01]))
                    conn.cancel()
                    return
                }
                let ulen = Int(authData[1])
                guard authData.count >= 2 + ulen + 1 else { conn.cancel(); return }
                let uname = String(data: authData[2..<(2 + ulen)], encoding: .utf8) ?? ""
                let plen = Int(authData[2 + ulen])
                guard authData.count >= 2 + ulen + 1 + plen else { conn.cancel(); return }
                let pass = String(data: authData[(3 + ulen)..<(3 + ulen + plen)], encoding: .utf8) ?? ""
                let ok = accounts.contains { $0.username == uname && $0.password == pass }
                if !ok {
                    _ = sendAndWait(conn, data: Data([0x01, 0x01]))
                    conn.cancel()
                    return
                }
                _ = sendAndWait(conn, data: Data([0x01, 0x00]))
            } else {
                _ = sendAndWait(conn, data: Data([0x05, 0xFF]))
                conn.cancel()
                return
            }
        } else {
            if methods.contains(0x00) {
                _ = sendAndWait(conn, data: Data([0x05, 0x00]))
            } else {
                _ = sendAndWait(conn, data: Data([0x05, 0xFF]))
                conn.cancel()
                return
            }
        }

        guard let connectData = readBytesSync(conn, min: 4, max: 260) else { conn.cancel(); return }
        guard connectData.count >= 4, connectData[0] == 0x05, connectData[1] == 0x01 else {
            conn.cancel()
            return
        }

        let atyp = Int(connectData[3])
        var host = ""
        var targetPort = 0

        switch atyp {
        case 1: // IPv4
            guard connectData.count >= 10 else { conn.cancel(); return }
            let parts = (4..<8).map { "\(connectData[$0])" }
            host = parts.joined(separator: ".")
            targetPort = (Int(connectData[8]) << 8) | Int(connectData[9])
        case 3: // Domain
            let domainLen = Int(connectData[4])
            guard connectData.count >= 5 + domainLen + 2 else { conn.cancel(); return }
            host = String(data: connectData[5..<(5 + domainLen)], encoding: .utf8) ?? ""
            targetPort = (Int(connectData[5 + domainLen]) << 8) | Int(connectData[6 + domainLen])
        case 4: // IPv6
            guard connectData.count >= 22 else { conn.cancel(); return }
            let parts = stride(from: 0, to: 16, by: 2).map {
                String(format: "%02x%02x", connectData[4 + $0], connectData[5 + $0])
            }
            host = parts.joined(separator: ":")
            targetPort = (Int(connectData[20]) << 8) | Int(connectData[21])
        default:
            conn.cancel()
            return
        }

        print("[Socks5Proxy] connect host=\(host) port=\(targetPort)")

        let resolvedAction = evaluateRules(host) ?? defaultAction
        print("[Socks5Proxy] action=\(resolvedAction)")

        switch resolvedAction {
        case "reject":
            let rejectReply = Data([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            _ = sendAndWait(conn, data: rejectReply)
            conn.cancel()
        case "direct":
            let directReply = Data([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            _ = sendAndWait(conn, data: directReply)
            if let onDirect = onDirectRequest {
                onDirect(host, targetPort, conn)
            } else {
                directConnect(host: host, port: targetPort, clientConn: conn)
            }
        default:
            let forwardReply = Data([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            _ = sendAndWait(conn, data: forwardReply)
            onForwardRequest(host, targetPort, conn)
        }
    }

    // MARK: - HTTP Handler

    private func handleHttp(_ conn: NWConnection, initialData: Data) {
        guard let requestStr = String(data: initialData, encoding: .utf8), requestStr.count >= 4 else {
            conn.cancel()
            return
        }

        if useAuth {
            let lines = requestStr.components(separatedBy: "\r\n")
            let authLine = lines.first { $0.lowercased().hasPrefix("proxy-authorization:") }
            let authorized: Bool
            if let auth = authLine {
                let encoded = auth.components(separatedBy: "Basic ").last?.trimmingCharacters(in: .whitespaces) ?? ""
                if let decodedData = Data(base64Encoded: encoded),
                   let decoded = String(data: decodedData, encoding: .utf8) {
                    let parts = decoded.components(separatedBy: ":")
                    authorized = parts.count == 2 && accounts.contains {
                        $0.username == parts[0] && $0.password == parts[1]
                    }
                } else {
                    authorized = false
                }
            } else {
                authorized = false
            }
            if !authorized {
                let resp = "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Bi-Tunnel\"\r\n\r\n"
                _ = sendAndWait(conn, data: resp.data(using: .utf8) ?? Data())
                conn.cancel()
                return
            }
        }

        let isConnect = requestStr.uppercased().hasPrefix("CONNECT")
        if isConnect {
            let parts = requestStr.components(separatedBy: " ").first?.components(separatedBy: " ")
            guard let p = parts, p.count >= 2 else { conn.cancel(); return }
            let hostPort = p[1]
            let host = hostPort.components(separatedBy: ":").first ?? ""
            let pnum = Int(hostPort.components(separatedBy: ":").last ?? "") ?? 443
            let resolvedAction = evaluateRules(host) ?? defaultAction
            switch resolvedAction {
            case "reject":
                _ = sendAndWait(conn, data: "HTTP/1.1 403 Forbidden\r\n\r\n".data(using: .utf8)!)
                conn.cancel()
            case "direct":
                _ = sendAndWait(conn, data: "HTTP/1.1 200 Connection Established\r\n\r\n".data(using: .utf8)!)
                if let onDirect = onDirectRequest {
                    onDirect(host, pnum, conn)
                } else {
                    directConnect(host: host, port: pnum, clientConn: conn)
                }
            default:
                _ = sendAndWait(conn, data: "HTTP/1.1 200 Connection Established\r\n\r\n".data(using: .utf8)!)
                onForwardRequest(host, pnum, conn)
            }
        } else {
            let parts = requestStr.components(separatedBy: " ").first?.components(separatedBy: " ")
            guard let p = parts, p.count >= 2 else { conn.cancel(); return }
            let url = p[1]
            guard let uri = URL(string: url) else { conn.cancel(); return }
            guard let host = uri.host else { conn.cancel(); return }
            let targetPort = uri.port ?? 80
            let resolvedAction = evaluateRules(host) ?? defaultAction
            switch resolvedAction {
            case "reject":
                _ = sendAndWait(conn, data: "HTTP/1.1 403 Forbidden\r\n\r\n".data(using: .utf8)!)
                conn.cancel()
            case "direct":
                if let onDirect = onDirectRequest {
                    onDirect(host, targetPort, conn)
                } else {
                    directConnect(host: host, port: targetPort, clientConn: conn)
                }
            default:
                onForwardRequest(host, targetPort, conn)
            }
        }
    }

    // MARK: - Rule Evaluation

    private func evaluateRules(_ host: String) -> String? {
        for rule in rules {
            guard rule.enabled else { continue }
            let patterns = rule.matchValue.components(separatedBy: "\n").map {
                $0.trimmingCharacters(in: .whitespaces)
            }.filter { !$0.isEmpty }
            let matches: Bool
            switch rule.matchType {
            case "any":
                matches = true
            case "auto":
                matches = patterns.contains { pattern in
                    if pattern == "any" || pattern == "*" || pattern == "all" || pattern == "0.0.0.0/0" || pattern == "::/0" {
                        return true
                    }
                    if pattern.contains("/") { return matchesCIDR(host, pattern) }
                    if pattern.contains(where: { $0.isLetter || $0 == "*" || $0 == "?" }) {
                        return matchesGlob(host, pattern.trimmingCharacters(in: CharacterSet(charactersIn: ".")))
                    }
                    if pattern.allSatisfy({ $0.isNumber || $0 == "." }) { return host == pattern }
                    return host == pattern
                }
            case "domain":
                matches = patterns.contains { matchesGlob(host, $0.trimmingCharacters(in: CharacterSet(charactersIn: "."))) }
            case "ip":
                matches = patterns.contains { $0 == host }
            case "cidr":
                matches = patterns.contains { matchesCIDR(host, $0) }
            default:
                matches = false
            }
            if matches { return rule.action }
        }
        return nil
    }

    private func matchesGlob(_ host: String, _ pattern: String) -> Bool {
        var p = pattern.startIndex
        var h = host.startIndex
        var starP: String.Index? = nil
        var starH = host.startIndex

        while h < host.endIndex {
            if p < pattern.endIndex && (pattern[p] == host[h] || pattern[p] == "?") {
                p = pattern.index(after: p)
                h = host.index(after: h)
            } else if p < pattern.endIndex && pattern[p] == "*" {
                starP = p
                starH = h
                p = pattern.index(after: p)
            } else if let sp = starP {
                p = pattern.index(after: sp)
                starH = host.index(after: starH)
                h = starH
            } else {
                return false
            }
        }
        while p < pattern.endIndex && pattern[p] == "*" {
            p = pattern.index(after: p)
        }
        return p == pattern.endIndex
    }

    private func matchesCIDR(_ host: String, _ cidr: String) -> Bool {
        let parts = cidr.components(separatedBy: "/")
        guard parts.count == 2, let prefixLen = Int(parts[1]) else { return false }
        guard let hostAddr = addrToBytes(host) else { return false }
        guard let cidrAddr = addrToBytes(parts[0]) else { return false }
        guard hostAddr.count == cidrAddr.count else { return false }

        let fullBytes = prefixLen / 8
        let remainingBits = prefixLen % 8

        for i in 0..<fullBytes {
            guard i < hostAddr.count, i < cidrAddr.count else { return false }
            if hostAddr[i] != cidrAddr[i] { return false }
        }

        if remainingBits > 0 && fullBytes < hostAddr.count {
            let mask: UInt8 = UInt8(0xFF << (8 - remainingBits))
            return (hostAddr[fullBytes] & mask) == (cidrAddr[fullBytes] & mask)
        }
        return true
    }

    private func addrToBytes(_ addr: String) -> [UInt8]? {
        // Try IPv4
        var sin = sockaddr_in()
        if inet_pton(AF_INET, addr, &sin.sin_addr) == 1 {
            let data = withUnsafeBytes(of: sin.sin_addr)         { (buf: UnsafeRawBufferPointer) in Data(buf) }
            return [UInt8](data)
        }
        // Try IPv6
        var sin6 = sockaddr_in6()
        if inet_pton(AF_INET6, addr, &sin6.sin6_addr) == 1 {
            let data = withUnsafeBytes(of: sin6.sin6_addr)         { (buf: UnsafeRawBufferPointer) in Data(buf) }
            return [UInt8](data)
        }
        // Resolve hostname
        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var res: UnsafeMutablePointer<addrinfo>? = nil
        defer { if res != nil { freeaddrinfo(res) } }

        let result = getaddrinfo(addr, nil, &hints, &res)
        guard result == 0, let addrList = res else { return nil }

        var ptr = addrList
        while true {
            guard let addrPtr = ptr.pointee.ai_addr else { break }
            if ptr.pointee.ai_family == AF_INET {
                let sin = addrPtr.withMemoryRebound(to: sockaddr_in.self, capacity: 1).pointee
                let data = withUnsafeBytes(of: sin.sin_addr) { (buf: UnsafeRawBufferPointer) in Data(buf) }
                return [UInt8](data)
            } else if ptr.pointee.ai_family == AF_INET6 {
                let sin6 = addrPtr.withMemoryRebound(to: sockaddr_in6.self, capacity: 1).pointee
                let data = withUnsafeBytes(of: sin6.sin6_addr) { (buf: UnsafeRawBufferPointer) in Data(buf) }
                return [UInt8](data)
            }
            guard let next = ptr.pointee.ai_next else { break }
            ptr = next
        }
            guard let next = ptr.pointee.ai_next else { break }
            ptr = next
        }
        return nil
    }

    // MARK: - Direct Connect

    private func directConnect(host: String, port: Int, clientConn: NWConnection) {
        print("[Socks5Proxy] directConnect start host=\(host) port=\(port)")
        let directQueue = DispatchQueue(label: "direct-connect-\(host)-\(port)")
        directQueue.async { [weak self] in
            guard let self = self else { return }

            print("[Socks5Proxy] directConnect: resolving DNS for \(host)")
            let dnsSem = DispatchSemaphore(value: 0)
            var resolvedAddr = "\(host)"
            var dnsSuccess = true

            // Resolve DNS on a separate queue with timeout
            let dnsQueue = DispatchQueue(label: "dns-\(host)")
            dnsQueue.async {
                var hints = addrinfo()
                hints.ai_family = AF_UNSPEC
                hints.ai_socktype = SOCK_STREAM
                var res: UnsafeMutablePointer<addrinfo>? = nil
                let err = getaddrinfo(host, nil, &hints, &res)
                if err == 0, let addrList = res {
                    var ptr = addrList
                    var found = false
                    while !found {
                        guard let addrPtr = ptr.pointee.ai_addr else { break }
                        if ptr.pointee.ai_family == AF_INET {
                            let sin = addrPtr.withMemoryRebound(to: sockaddr_in.self, capacity: 1).pointee
                            var ipStr = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                            inet_ntop(AF_INET, &sin.sin_addr, &ipStr, socklen_t(INET_ADDRSTRLEN))
                            resolvedAddr = String(cString: ipStr)
                            found = true
                        } else if ptr.pointee.ai_family == AF_INET6 {
                            let sin6 = addrPtr.withMemoryRebound(to: sockaddr_in6.self, capacity: 1).pointee
                            var ipStr = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
                            inet_ntop(AF_INET6, &sin6.sin6_addr, &ipStr, socklen_t(INET6_ADDRSTRLEN))
                            resolvedAddr = String(cString: ipStr)
                            found = true
                        }
                        if found { break }
                        guard let next = ptr.pointee.ai_next else { break }
                        ptr = next
                    }
                    freeaddrinfo(res)
                }
                if err != 0 { dnsSuccess = false }
                dnsSem.signal()
            }

            let dnsTimeout = dnsSem.wait(timeout: .now() + .seconds(10))
            guard dnsSuccess, dnsTimeout != .timedOut else {
                print("[Socks5Proxy] directConnect: DNS failed or timeout for \(host)")
                clientConn.cancel()
                return
            }
            print("[Socks5Proxy] directConnect: DNS resolved \(host) -> \(resolvedAddr)")

            let remoteEndpoint = NWEndpoint.hostPort(
                host: NWEndpoint.Host(resolvedAddr),
                port: NWEndpoint.Port(rawValue: UInt16(port))!
            )

            let params = NWParameters.tcp
            let remote = NWConnection(to: remoteEndpoint, using: params)
            let connectSem = DispatchSemaphore(value: 0)
            var connectError: NWError?

            remote.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    print("[Socks5Proxy] directConnect: connected to \(resolvedAddr):\(port)")
                    connectSem.signal()
                case .failed(let error):
                    print("[Socks5Proxy] directConnect: connection error \(error)")
                    connectError = error
                    connectSem.signal()
                default:
                    break
                }
            }
            remote.start(queue: directQueue)

            let waitResult = connectSem.wait(timeout: .now() + .seconds(15))
            if waitResult == .timedOut || connectError != nil {
                print("[Socks5Proxy] directConnect: failed to connect to \(host):\(port)")
                clientConn.cancel()
                remote.cancel()
                return
            }

            // Bidirectional copy using concurrent relays
            let toRemoteQueue = DispatchQueue(label: "toRemote-\(host)-\(port)")
            let toClientQueue = DispatchQueue(label: "toClient-\(host)-\(port)")

            let doneSem = DispatchSemaphore(value: 0)
            var toRemoteDone = false
            var toClientDone = false

            func relayStream(from: NWConnection, to: NWConnection, onDone: @escaping () -> Void) {
                func readNext() {
                    from.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, error in
                        guard let d = data, !d.isEmpty, error == nil else {
                            onDone()
                            return
                        }
                        to.send(content: d, completion: .contentProcessed { _ in
                            readNext()
                        })
                    }
                }
                readNext()
            }

            toRemoteQueue.async {
                relayStream(from: clientConn, to: remote) {
                    toRemoteDone = true
                    remote.send(content: nil, completion: .contentProcessed { _ in
                        if toClientDone { doneSem.signal() }
                    })
                }
            }

            toClientQueue.async {
                relayStream(from: remote, to: clientConn) {
                    toClientDone = true
                    clientConn.send(content: nil, completion: .contentProcessed { _ in
                        if toRemoteDone { doneSem.signal() }
                    })
                }
            }

            doneSem.wait()
            print("[Socks5Proxy] directConnect: done")
            clientConn.cancel()
            print("[Socks5Proxy] directConnect: closed client socket")
        }
    }

    // MARK: - Blocking I/O Helpers

    private func readBytesSync(_ conn: NWConnection, min: Int, max: Int) -> Data? {
        let sem = DispatchSemaphore(value: 0)
        var result: Data?
        conn.receive(minimumIncompleteLength: min, maximumLength: max) { data, _, _, error in
            if let d = data, error == nil {
                result = d
            }
            sem.signal()
        }
        sem.wait()
        return result
    }

    @discardableResult
    private func sendAndWait(_ conn: NWConnection, data: Data) -> Bool {
        let sem = DispatchSemaphore(value: 0)
        var success = false
        conn.send(content: data, completion: .contentProcessed { error in
            success = error == nil
            sem.signal()
        })
        sem.wait()
        return success
    }
}

private let HTTP_PROTO_BYTES: Set<UInt8> = [
    Character("G").asciiValue!, Character("P").asciiValue!,
    Character("H").asciiValue!, Character("C").asciiValue!,
    Character("D").asciiValue!, Character("O").asciiValue!
]
