package com.bitunnel.mobile.mux

import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.BlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.concurrent.thread

data class MuxFrame(
    val type: Int,
    val channelId: Long,
    val payload: ByteArray
)

class MuxSession(
    private val inputStream: InputStream,
    private val outputStream: OutputStream,
    password: String?
) {
    companion object {
        const val TYPE_DATA = 1
        const val TYPE_CREATE = 2
        const val TYPE_CLOSE = 3
        const val TYPE_AUTH = 4
        const val TYPE_AUTH_RES = 5
        const val TYPE_CREATE_ACK = 6

        private const val AES_ALG = "AES/GCM/NoPadding"
        private const val AES_IV_LEN = 12
        private const val AES_TAG_LEN = 16
        private const val HEADER_SIZE = 9
        private const val MAX_FRAME_SIZE = 16 * 1024 * 1024
    }

    private val encryptionKey: ByteArray? =
        if (!password.isNullOrEmpty()) {
            val md = MessageDigest.getInstance("SHA-256")
            md.digest(password.toByteArray())
        } else null

    @Volatile
    var isAuthenticated = false
        private set

    @Volatile
    private var closed = false

    private val frameListeners = ConcurrentHashMap<Long, BlockingQueue<MuxFrame>>()
    private var readerThread: Thread? = null
    private var controlHandler: ((MuxFrame) -> Unit)? = null

    fun startReader(handler: (MuxFrame) -> Unit) {
        controlHandler = handler
        readerThread = thread(isDaemon = false, name = "mux-reader") {
            try {
                while (!closed) {
                    val frame = readFrame() ?: break
                    val queue = frameListeners[frame.channelId]
                    if (queue != null) {
                        queue.put(frame)
                    } else {
                        controlHandler?.invoke(frame)
                    }
                }
            } catch (_: Exception) {
            } finally {
                closed = true
            }
        }
    }

    fun stopReader() {
        closed = true
        readerThread?.join(2000)
        readerThread = null
        frameListeners.clear()
    }

    fun subscribeChannel(channelId: Long): BlockingQueue<MuxFrame> {
        val queue = LinkedBlockingQueue<MuxFrame>()
        frameListeners[channelId] = queue
        return queue
    }

    fun unsubscribeChannel(channelId: Long) {
        frameListeners.remove(channelId)
    }

    fun sendAuth(password: String, clientId: String) {
        val payload = """{"password":"$password","clientId":"$clientId"}""".toByteArray()
        sendFrame(TYPE_AUTH, 0, payload)
    }

    fun sendAuthRes(ok: Boolean) {
        sendFrame(TYPE_AUTH_RES, 0, byteArrayOf(if (ok) 1 else 0))
        if (ok) isAuthenticated = true
    }

    fun sendData(channelId: Long, data: ByteArray) {
        sendFrame(TYPE_DATA, channelId, data)
    }

    fun sendCreate(channelId: Long, host: String, port: Int) {
        val meta = """{"type":"forward","host":"$host","port":$port}""".toByteArray()
        sendFrame(TYPE_CREATE, channelId, meta)
    }

    fun sendCreateAck(channelId: Long, success: Boolean) {
        sendFrame(TYPE_CREATE_ACK, channelId, byteArrayOf(if (success) 1 else 0))
    }

    fun sendClose(channelId: Long) {
        sendFrame(TYPE_CLOSE, channelId, ByteArray(0))
    }

    @Synchronized
    fun sendFrame(type: Int, channelId: Long, payload: ByteArray) {
        if (closed || encryptionKey == null && type != TYPE_AUTH && type != TYPE_AUTH_RES) return
        val encrypted = encrypt(payload)
        val header = ByteBuffer.allocate(HEADER_SIZE)
        header.put(type.toByte())
        header.putInt(channelId.toInt())
        header.putInt(encrypted.size)
        try {
            outputStream.write(header.array())
            outputStream.write(encrypted)
            outputStream.flush()
        } catch (e: Exception) {
            closed = true
            throw e
        }
    }

    fun readFrame(): MuxFrame? {
        try {
            val header = ByteArray(HEADER_SIZE)
            var offset = 0
            while (offset < HEADER_SIZE) {
                val n = inputStream.read(header, offset, HEADER_SIZE - offset)
                if (n < 0) return null
                offset += n
            }
            val buf = ByteBuffer.wrap(header)
            val type = buf.get().toInt() and 0xFF
            val channelId = buf.getInt().toLong() and 0xFFFFFFFFL
            val payloadLen = buf.getInt()

            if (payloadLen < 0 || payloadLen > MAX_FRAME_SIZE + AES_IV_LEN + AES_TAG_LEN) {
                return null
            }

            val encrypted = ByteArray(payloadLen)
            offset = 0
            while (offset < payloadLen) {
                val n = inputStream.read(encrypted, offset, payloadLen - offset)
                if (n < 0) return null
                offset += n
            }

            val payload = decrypt(encrypted)
            return MuxFrame(type, channelId, payload)
        } catch (e: Exception) {
            return null
        }
    }

    private fun encrypt(plaintext: ByteArray): ByteArray {
        if (encryptionKey == null) return plaintext
        val cipher = Cipher.getInstance(AES_ALG)
        val iv = ByteArray(AES_IV_LEN)
        SecureRandom().nextBytes(iv)
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(encryptionKey, "AES"), GCMParameterSpec(AES_TAG_LEN * 8, iv))
        val encrypted = cipher.doFinal(plaintext)
        return iv + encrypted
    }

    private fun decrypt(data: ByteArray): ByteArray {
        if (encryptionKey == null) return data
        if (data.size < AES_IV_LEN + AES_TAG_LEN) return ByteArray(0)
        val cipher = Cipher.getInstance(AES_ALG)
        val iv = data.copyOfRange(0, AES_IV_LEN)
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(encryptionKey, "AES"), GCMParameterSpec(AES_TAG_LEN * 8, iv))
        return cipher.doFinal(data, AES_IV_LEN, data.size - AES_IV_LEN)
    }

    fun close() {
        closed = true
        try { inputStream.close() } catch (_: Exception) {}
        try { outputStream.close() } catch (_: Exception) {}
    }

    val isClosed: Boolean get() = closed
}
