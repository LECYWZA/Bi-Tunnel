package com.bitunnel.mobile.mux

import android.util.Log
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

class TunnelServer(
    private val listenPort: Int,
    private val password: String,
    private val bindIp: String = "127.0.0.1",
    private val sni: String = "mail.qq.com",
    private val onClientConnect: ((String) -> Unit)? = null,
    private val onClientDisconnect: ((String) -> Unit)? = null
) {
    private var serverSocket: ServerSocket? = null
    @Volatile
    var running = false
        private set

    private val sessions = ConcurrentHashMap<String, MuxSession>()
    private val channelIdCounter = AtomicLong(1)

    fun start() {
        running = true
        thread(isDaemon = false, name = "tunnel-server-${listenPort}") {
            try {
                val addr = if (bindIp.isNotEmpty()) InetAddress.getByName(bindIp) else null
                val ss = if (addr != null) ServerSocket(listenPort, 50, addr) else ServerSocket(listenPort)
                serverSocket = ss

                while (running) {
                    try {
                        val client = ss.accept()
                        thread(isDaemon = true) { handleClient(client) }
                    } catch (_: Exception) {
                        if (!running) break
                    }
                }
            } catch (_: Exception) {
                running = false
            }
        }
    }

    fun stop() {
        running = false
        for ((_, session) in sessions) {
            session.close()
        }
        sessions.clear()
        try { serverSocket?.close() } catch (_: Exception) {}
    }

    private fun handleClient(socket: Socket) {
        var clientId: String? = null
        try {
            val input: InputStream = socket.getInputStream()
            val output: OutputStream = socket.getOutputStream()

            val mux = MuxSession(input, output, password)
            clientId = authenticateClient(mux) ?: run {
                socket.close()
                return
            }

            sessions[clientId] = mux
            onClientConnect?.invoke(clientId)
            Log.i("TunnelServer", "Client connected: $clientId")
            mux.startReader { frame -> handleControlFrame(mux, frame) }
            while (!mux.isClosed) {
                try { Thread.sleep(1000) } catch (_: InterruptedException) { break }
            }
        } catch (_: Exception) {
            try { socket.close() } catch (_: Exception) {}
        } finally {
            if (clientId != null) {
                sessions.remove(clientId)
                onClientDisconnect?.invoke(clientId)
            }
        }
    }

    private fun authenticateClient(mux: MuxSession): String? {
        val timeout = 30000L
        val start = System.currentTimeMillis()

        while (System.currentTimeMillis() - start < timeout) {
            val frame = mux.readFrame() ?: return null
            if (frame.type == MuxSession.TYPE_AUTH) {
                val metaStr = String(frame.payload)
                try {
                    val json = org.json.JSONObject(metaStr)
                    val clientPassword = json.optString("password", "")
                    val clientId = json.optString("clientId", "")

                    if (clientPassword == password && clientId.isNotEmpty()) {
                        mux.sendAuthRes(true)
                        return clientId
                    }
                } catch (_: Exception) {}
                mux.sendAuthRes(false)
                return null
            }
        }
        return null
    }

    private fun handleControlFrame(mux: MuxSession, frame: MuxFrame) {
        when (frame.type) {
            MuxSession.TYPE_CREATE -> {
                val metaStr = String(frame.payload)
                try {
                    val json = org.json.JSONObject(metaStr)
                    val host = json.optString("host", "")
                    val port = json.optInt("port", 0)
                    if (host.isNotEmpty() && port > 0) {
                        thread(isDaemon = true) {
                            connectTarget(mux, frame.channelId, host, port)
                        }
                    }
                } catch (_: Exception) {}
            }
        }
    }

    private fun connectTarget(mux: MuxSession, channelId: Long, host: String, port: Int) {
        var remote: Socket? = null
        try {
            remote = Socket()
            remote.connect(InetSocketAddress(host, port), 15000)
            remote.soTimeout = 30000

            mux.sendCreateAck(channelId, true)

            val queue = mux.subscribeChannel(channelId)
            val remoteInput = remote.getInputStream()
            val remoteOutput = remote.getOutputStream()
            val buf = ByteArray(8192)

            val writeThread = thread(isDaemon = true) {
                try {
                    while (mux.isAuthenticated && !mux.isClosed) {
                        val frame = queue.poll(500, java.util.concurrent.TimeUnit.MILLISECONDS) ?: continue
                        when (frame.type) {
                            MuxSession.TYPE_DATA -> {
                                remoteOutput.write(frame.payload)
                                remoteOutput.flush()
                            }
                            MuxSession.TYPE_CLOSE -> break
                        }
                    }
                } catch (_: Exception) {}
                finally { mux.unsubscribeChannel(channelId) }
            }

            try {
                while (mux.isAuthenticated && !mux.isClosed) {
                    val n = remoteInput.read(buf)
                    if (n < 0) break
                    mux.sendData(channelId, buf.copyOfRange(0, n))
                }
            } catch (_: Exception) {}

            mux.sendClose(channelId)
            writeThread.join(3000)
        } catch (_: Exception) {
            mux.sendCreateAck(channelId, false)
        } finally {
            try { remote?.close() } catch (_: Exception) {}
        }
    }
}
