import Foundation
import Network
import CryptoKit

struct MuxFrame {
    let type: Int
    let channelId: UInt32
    let payload: Data
}

class MuxSession {
    static let TYPE_DATA = 1
    static let TYPE_CREATE = 2
    static let TYPE_CLOSE = 3
    static let TYPE_AUTH = 4
    static let TYPE_AUTH_RES = 5
    static let TYPE_CREATE_ACK = 6

    private let HEADER_SIZE = 9
    private let AES_IV_LEN = 12
    private let AES_TAG_LEN = 16
    private let MAX_FRAME_SIZE = 16 * 1024 * 1024

    private let connection: NWConnection
    private let encryptionKey: SymmetricKey?
    private let readQueue = DispatchQueue(label: "mux-reader")
    private let writeLock = NSLock()

    private var frameQueues: [UInt32: BlockingQueue<MuxFrame>] = [:]
    private var frameQueuesLock = NSLock()

    var isAuthenticated = false
    private(set) var isClosed = false
    var controlHandler: ((MuxFrame) -> Void)?

    init(connection: NWConnection, password: String?) {
        self.connection = connection
        if let pwd = password, !pwd.isEmpty {
            let hash = SHA256.hash(data: pwd.data(using: .utf8)!)
            encryptionKey = SymmetricKey(data: hash)
        } else {
            encryptionKey = nil
        }
    }

    func startReader(handler: @escaping (MuxFrame) -> Void) {
        controlHandler = handler
        readQueue.async { [weak self] in
            self?.readLoop()
        }
    }

    func stopReader() {
        isClosed = true
    }

    func subscribeChannel(_ channelId: UInt32) -> BlockingQueue<MuxFrame> {
        let q = BlockingQueue<MuxFrame>()
        frameQueuesLock.lock()
        frameQueues[channelId] = q
        frameQueuesLock.unlock()
        return q
    }

    func unsubscribeChannel(_ channelId: UInt32) {
        frameQueuesLock.lock()
        frameQueues.removeValue(forKey: channelId)
        frameQueuesLock.unlock()
    }

    func sendAuth(password: String, clientId: String) {
        let payload = "{\"password\":\"\(password)\",\"clientId\":\"\(clientId)\"}"
        sendFrame(type: MuxSession.TYPE_AUTH, channelId: 0, payload: payload.data(using: .utf8) ?? Data())
    }

    func sendAuthRes(_ ok: Bool) {
        sendFrame(type: MuxSession.TYPE_AUTH_RES, channelId: 0, payload: Data([ok ? 1 : 0]))
        if ok { isAuthenticated = true }
    }

    func sendData(channelId: UInt32, data: Data) {
        sendFrame(type: MuxSession.TYPE_DATA, channelId: channelId, payload: data)
    }

    func sendCreate(channelId: UInt32, host: String, port: Int) {
        let meta = "{\"type\":\"forward\",\"host\":\"\(host)\",\"port\":\(port)}"
        sendFrame(type: MuxSession.TYPE_CREATE, channelId: channelId, payload: meta.data(using: .utf8) ?? Data())
    }

    func sendCreateAck(channelId: UInt32, success: Bool) {
        sendFrame(type: MuxSession.TYPE_CREATE_ACK, channelId: channelId, payload: Data([success ? 1 : 0]))
    }

    func sendClose(channelId: UInt32) {
        sendFrame(type: MuxSession.TYPE_CLOSE, channelId: channelId, payload: Data())
    }

    func close() {
        isClosed = true
        connection.cancel()
    }

    // MARK: - Frame I/O

    private func sendFrame(type: Int, channelId: UInt32, payload: Data) {
        guard !isClosed else { return }
        let encrypted = encrypt(payload)
        var header = Data(capacity: HEADER_SIZE + encrypted.count)
        header.append(UInt8(type))
        header.append(contentsOf: withUnsafeBytes(of: channelId.bigEndian) { Data($0) })
        header.append(contentsOf: withUnsafeBytes(of: UInt32(encrypted.count).bigEndian) { Data($0) })
        header.append(encrypted)

        writeLock.lock()
        connection.send(content: header, completion: .contentProcessed { _ in })
        writeLock.unlock()
    }

    private func readLoop() {
        while !isClosed {
            guard let frame = readFrameSync() else {
                isClosed = true
                return
            }
            var queue: BlockingQueue<MuxFrame>?
            frameQueuesLock.lock()
            queue = frameQueues[frame.channelId]
            frameQueuesLock.unlock()

            if let q = queue {
                q.put(frame)
            } else {
                controlHandler?(frame)
            }
        }
    }

    private func readFrameSync() -> MuxFrame? {
        guard let header = readBytesSync(length: HEADER_SIZE) else { return nil }
        guard header.count == HEADER_SIZE else { return nil }

        let type = Int(header[0])
        let channelId = header.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 1, as: UInt32.self) }.bigEndian
        let payloadLen = header.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 5, as: UInt32.self) }.bigEndian

        guard payloadLen <= MAX_FRAME_SIZE + AES_IV_LEN + AES_TAG_LEN else { return nil }
        guard payloadLen > 0 else { return MuxFrame(type: type, channelId: channelId, payload: Data()) }

        guard let encrypted = readBytesSync(length: Int(payloadLen)) else { return nil }
        let payload = decrypt(encrypted)
        return MuxFrame(type: type, channelId: channelId, payload: payload)
    }

    func readFrame() -> MuxFrame? {
        return readFrameSync()
    }

    private func readBytesSync(length: Int) -> Data? {
        var result = Data()
        let semaphore = DispatchSemaphore(value: 0)

        var lastError: NWError?
        var lastData: Data?

        connection.receive(minimumIncompleteLength: length, maximumLength: length) { data, _, _, error in
            lastData = data
            lastError = error
            semaphore.signal()
        }

        semaphore.wait()

        if let err = lastError {
            print("[MuxSession] read error: \(err)")
            return nil
        }
        guard let d = lastData, d.count == length else {
            return nil
        }
        return d
    }

    // MARK: - Encryption

    private func encrypt(_ plaintext: Data) -> Data {
        guard let key = encryptionKey else { return plaintext }
        do {
            let sealed = try AES.GCM.seal(plaintext, using: key)
            return sealed.nonce + sealed.ciphertext + sealed.tag
        } catch {
            return plaintext
        }
    }

    private func decrypt(_ data: Data) -> Data {
        guard let key = encryptionKey else { return data }
        guard data.count > AES_IV_LEN + AES_TAG_LEN else { return Data() }
        do {
            let nonce = try AES.GCM.Nonce(data: data.prefix(AES_IV_LEN))
            let box = try AES.GCM.SealedBox(
                nonce: nonce,
                ciphertext: data.dropFirst(AES_IV_LEN).dropLast(AES_TAG_LEN),
                tag: data.suffix(AES_TAG_LEN)
            )
            return try AES.GCM.open(box, using: key)
        } catch {
            return data
        }
    }
}

// MARK: - Blocking Queue

class BlockingQueue<T> {
    private var items: [T] = []
    private let lock = NSLock()
    private let sem = DispatchSemaphore(value: 0)

    func put(_ item: T) {
        lock.lock()
        items.append(item)
        lock.unlock()
        sem.signal()
    }

    func poll(timeout: DispatchTime) -> T? {
        let result = sem.wait(timeout: timeout)
        if result == .timedOut { return nil }
        lock.lock()
        let item = items.removeFirst()
        lock.unlock()
        return item
    }

    func take() -> T {
        sem.wait()
        lock.lock()
        let item = items.removeFirst()
        lock.unlock()
        return item
    }
}
