package com.bitunnel.mobile.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import com.bitunnel.mobile.mux.MuxFrame
import com.bitunnel.mobile.mux.MuxSession
import com.bitunnel.mobile.mux.ProxyAccount
import com.bitunnel.mobile.mux.ProxyRule
import com.bitunnel.mobile.mux.ProxyType
import com.bitunnel.mobile.mux.RuleAction
import com.bitunnel.mobile.mux.Socks5Proxy
import com.bitunnel.mobile.mux.TunnelServer
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

data class ClientState(
    val id: String,
    val host: String,
    val port: Int,
    val password: String,
    val clientId: String,
    val sni: String,
    val proxyPort: Int,
    val rules: List<ProxyRule>
)

data class ServerState(
    val id: String,
    val listenPort: Int,
    val password: String,
    val sni: String
)

class TunnelService : Service() {
    companion object {
        const val CHANNEL_ID = "bitunnel_channel"
        const val NOTIFICATION_ID = 1
        const val TAG = "BiTunnel"

        const val ACTION_START_CLIENT = "com.bitunnel.mobile.START_CLIENT"
        const val ACTION_STOP_CLIENT = "com.bitunnel.mobile.STOP_CLIENT"
        const val ACTION_START_SERVER = "com.bitunnel.mobile.START_SERVER"
        const val ACTION_STOP_SERVER = "com.bitunnel.mobile.STOP_SERVER"
        const val ACTION_START_PROXY = "com.bitunnel.mobile.START_PROXY"
        const val ACTION_STOP_PROXY = "com.bitunnel.mobile.STOP_PROXY"
        const val ACTION_GET_STATUS = "com.bitunnel.mobile.GET_STATUS"
        const val ACTION_UPDATE_STATUS = "com.bitunnel.mobile.UPDATE_STATUS"

        var statusCallback: ((Map<String, Any?>) -> Unit)? = null

        @Volatile
        var currentStatus: Map<String, Any?> = mapOf("state" to "disconnected")
            private set
    }

    private val clientRunners = ConcurrentHashMap<String, ClientRunner>()
    private val serverRunners = ConcurrentHashMap<String, ServerRunner>()
    private val proxyRunners = ConcurrentHashMap<String, ProxyRunner>()
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service onCreate")
        try {
            createNotificationChannel()
            startForeground(NOTIFICATION_ID, createNotification("Bi-Tunnel 后台服务运行中"))
            Log.i(TAG, "Service foreground started")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground", e)
        }
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: "null"
        val jsonStr = intent?.getStringExtra("config_json")
        Log.i(TAG, "Service onStartCommand: action=$action hasConfig=${jsonStr != null}")
        when (intent?.action) {
            ACTION_START_CLIENT -> {
                val config = if (jsonStr != null) jsonToMap(jsonStr) else return START_STICKY
                startClientInstance(config)
            }
            ACTION_STOP_CLIENT -> {
                val id = intent.getStringExtra("instanceId") ?: return START_STICKY
                stopClientInstance(id)
            }
            ACTION_START_SERVER -> {
                val config = if (jsonStr != null) jsonToMap(jsonStr) else return START_STICKY
                startServerInstance(config)
            }
            ACTION_STOP_SERVER -> {
                val id = intent.getStringExtra("instanceId") ?: return START_STICKY
                stopServerInstance(id)
            }
            ACTION_START_PROXY -> {
                val config = if (jsonStr != null) jsonToMap(jsonStr) else return START_STICKY
                startProxyInstance(config)
            }
            ACTION_STOP_PROXY -> {
                val id = intent.getStringExtra("instanceId") ?: return START_STICKY
                stopProxyInstance(id)
            }
            ACTION_GET_STATUS -> emitAllStatus()
            ACTION_UPDATE_STATUS -> emitAllStatus()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        for ((_, r) in clientRunners) r.stop()
        clientRunners.clear()
        for ((_, r) in serverRunners) r.stop()
        serverRunners.clear()
        for ((_, r) in proxyRunners) r.stop()
        proxyRunners.clear()
        releaseWakeLock()
        super.onDestroy()
    }

    private fun startClientInstance(config: Map<String, Any?>) {
        val id = config["id"] as? String ?: run {
            Log.e(TAG, "startClientInstance: missing id in config"); return
        }
        if (clientRunners.containsKey(id)) {
            Log.w(TAG, "startClientInstance: runner already exists for $id"); return
        }
        Log.i(TAG, "startClientInstance: id=$id")

        val runner = ClientRunner(config)
        clientRunners[id] = runner
        runner.start()
        emitAllStatus()
    }

    private fun stopClientInstance(id: String) {
        val runner = clientRunners.remove(id) ?: return
        runner.stop()
        emitAllStatus()
    }

    private fun startServerInstance(config: Map<String, Any?>) {
        val id = config["id"] as? String ?: return
        if (serverRunners.containsKey(id)) return

        val runner = ServerRunner(config)
        serverRunners[id] = runner
        runner.start()
        emitAllStatus()
    }

    private fun stopServerInstance(id: String) {
        val runner = serverRunners.remove(id) ?: return
        runner.stop()
        emitAllStatus()
    }

    private fun startProxyInstance(config: Map<String, Any?>) {
        val id = config["id"] as? String ?: return
        if (proxyRunners.containsKey(id)) return

        val runner = ProxyRunner(config)
        proxyRunners[id] = runner
        runner.start()
        emitAllStatus()
    }

    private fun stopProxyInstance(id: String) {
        val runner = proxyRunners.remove(id) ?: return
        runner.stop()
        emitAllStatus()
    }

    private fun parseRules(raw: Any?): List<ProxyRule> {
        val rawList = raw as? List<Map<String, Any?>> ?: return emptyList()
        return rawList.mapNotNull { r ->
            try {
                val actionStr = r["action"] as? String ?: return@mapNotNull null
                val action = when (actionStr) {
                    "forward" -> RuleAction.FORWARD
                    "direct" -> RuleAction.DIRECT
                    "reject" -> RuleAction.REJECT
                    else -> return@mapNotNull null
                }
                ProxyRule(
                    matchType = r["matchType"] as? String ?: "any",
                    matchValue = r["matchValue"] as? String ?: "",
                    action = action,
                    enabled = r["enabled"] as? Boolean ?: true
                )
            } catch (_: Exception) { null }
        }
    }

    private fun parseAccounts(raw: Any?): List<ProxyAccount> {
        val rawList = raw as? List<Map<String, Any?>> ?: return emptyList()
        return rawList.map { r ->
            ProxyAccount(
                username = r["username"] as? String ?: "",
                password = r["password"] as? String ?: "",
                enabled = r["enabled"] as? Boolean ?: true
            )
        }
    }

    private fun jsonToMap(jsonStr: String): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>()
        val json = JSONObject(jsonStr)
        for (key in json.keys()) {
            map[key] = jsonToValue(json.get(key))
        }
        return map
    }

    private fun jsonToValue(obj: Any?): Any? {
        return when (obj) {
            is JSONObject -> {
                val m = mutableMapOf<String, Any?>()
                for (key in obj.keys()) m[key] = jsonToValue(obj.get(key))
                m
            }
            is JSONArray -> {
                val list = mutableListOf<Any?>()
                for (i in 0 until obj.length()) list.add(jsonToValue(obj.get(i)))
                list
            }
            else -> obj // String, Number, Boolean, null
        }
    }

    private fun emitAllStatus() {
        val instanceStatuses = mutableListOf<Map<String, Any?>>()
        for ((id, r) in clientRunners) {
            instanceStatuses.add(mapOf(
                "id" to id,
                "type" to "client",
                "running" to r.running,
                "status" to r.status,
                "error" to r.error
            ))
        }
        for ((id, r) in serverRunners) {
            instanceStatuses.add(mapOf(
                "id" to id,
                "type" to "server",
                "running" to r.running,
                "connectedClients" to r.connectedClients,
                "error" to r.error
            ))
        }
        for ((id, r) in proxyRunners) {
            instanceStatuses.add(mapOf(
                "id" to id,
                "type" to "proxy",
                "running" to r.running,
                "error" to r.error
            ))
        }
        currentStatus = mapOf("state" to "running", "instances" to instanceStatuses)
        val callback = statusCallback
        if (callback == null) {
            Log.w(TAG, "emitAllStatus: statusCallback is null!")
        } else {
            Log.i(TAG, "emitAllStatus: invoking callback with ${instanceStatuses.size} instances")
        }
        callback?.invoke(currentStatus)
        updateNotification()
    }

    inner class ClientRunner(private val config: Map<String, Any?>) {
        @Volatile
        var running = false
            private set
        @Volatile
        var status: String = "disconnected"
            private set
        @Volatile
        var error: String? = null
            private set

        private var thread: Thread? = null
        private var session: MuxSession? = null
        private var proxy: Socks5Proxy? = null
        private val bytesSent = AtomicLong(0)
        private val bytesReceived = AtomicLong(0)
        private var connectedSince: Long = 0

        fun start() {
            running = true
            status = "connecting"
            this@TunnelService.emitAllStatus()
            thread = thread(isDaemon = false, name = "client-runner") {
                try {
                    val host = config["serverHost"] as? String ?: throw Exception("Missing serverHost")
                    val port = (config["serverPort"] as? Number)?.toInt() ?: 33891
                    val password = config["password"] as? String ?: ""
                    val clientId = config["clientId"] as? String ?: "mobile-1"
                    val sni = config["sni"] as? String ?: "mail.qq.com"
                    val proxyPort = (config["localProxyPort"] as? Number)?.toInt() ?: 1080
                    val rules = parseRules(config["rules"])

                    Log.i(TAG, "Client $clientId connecting to $host:$port")

                    val socket = try {
                        TlsHelper.createClientSocket(host, port, 10000, sni)
                    } catch (_: Exception) {
                        TlsHelper.createClientSocketDirect(host, port, 10000)
                    }

                    val input: InputStream = socket.getInputStream()
                    val output: OutputStream = socket.getOutputStream()

                    val mux = MuxSession(input, output, password)
                    session = mux

                    mux.sendAuth(password, clientId)
                    Log.i(TAG, "Auth request sent for $clientId")

                    val authTimeout = 30000L
                    val authStart = System.currentTimeMillis()
                    var authenticated = false

                    while (running && System.currentTimeMillis() - authStart < authTimeout) {
                        val frame = mux.readFrame() ?: break
                        if (frame.type == MuxSession.TYPE_AUTH_RES) {
                            authenticated = frame.payload.isNotEmpty() && frame.payload[0].toInt() == 1
                            break
                        }
                    }

                    if (!authenticated) {
                        throw Exception("Authentication failed")
                    }

                    Log.i(TAG, "Client $clientId authenticated")
                    status = "connected"
                    this@TunnelService.emitAllStatus()
                    connectedSince = System.currentTimeMillis()
                    error = null

                    proxy = Socks5Proxy(
                        port = proxyPort,
                        onForwardRequest = { targetHost, targetPort, clientSocket ->
                            handleProxyRequest(mux, targetHost, targetPort, clientSocket)
                        },
                        rules = rules
                    )
                    proxy?.start()

                    mux.startReader { frame -> handleControlFrame(mux, frame) }

                    val pfRunners = mutableListOf<Thread>()
                    val rawPf = config["portForwards"]
                    if (rawPf is List<*>) {
                        for (pf in rawPf) {
                            if (pf is Map<*, *>) {
                                val pfListenPort = (pf["listenPort"] as? Number)?.toInt() ?: continue
                                val pfTargetHost = pf["targetHost"] as? String ?: continue
                                val pfTargetPort = (pf["targetPort"] as? Number)?.toInt() ?: continue
                                val enabled = pf["enabled"] as? Boolean ?: true
                                if (!enabled) continue
                                val t = thread(isDaemon = true, name = "pf-$pfListenPort") {
                                    try {
                                        val ss = java.net.ServerSocket(pfListenPort)
                                        while (running) {
                                            try {
                                                val client = ss.accept()
                                                handleProxyRequest(mux, pfTargetHost, pfTargetPort, client)
                                            } catch (_: Exception) {
                                                if (!running) break
                                            }
                                        }
                                    } catch (_: Exception) {}
                                }
                                pfRunners.add(t)
                            }
                        }
                    }

                    while (running) {
                        try { Thread.sleep(1000) } catch (_: InterruptedException) { break }
                    }

                } catch (e: Exception) {
                    Log.e(TAG, "Client error: ${e.message}", e)
                    if (running) {
                        status = "failed"
                        error = e.message ?: "连接错误"
                        this@TunnelService.emitAllStatus()
                    }
                } finally {
                    running = false
                    status = "disconnected"
                    proxy?.stop()
                    proxy = null
                    try { session?.close() } catch (_: Exception) {}
                    session = null
                    this@TunnelService.clientRunners.remove(config["id"] as? String)
                    emitAllStatus()
                }
            }
        }

        fun stop() {
            running = false
            proxy?.stop()
            proxy = null
            try { session?.close() } catch (_: Exception) {}
            session = null
            thread?.join(3000)
            thread = null
        }

        private var channelIdCounter = AtomicLong(1)

        private fun handleProxyRequest(mux: MuxSession, targetHost: String, targetPort: Int, clientSocket: Socket) {
            val channelId = channelIdCounter.getAndAdd(2)
            val queue = mux.subscribeChannel(channelId)

            thread(isDaemon = true) {
                try {
                    mux.sendCreate(channelId, targetHost, targetPort)
                    val input = clientSocket.getInputStream()
                    val output = clientSocket.getOutputStream()
                    val buf = ByteArray(8192)

                    val readThread = thread(isDaemon = true) {
                        try {
                            while (running) {
                                val frame = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                                when (frame.type) {
                                    MuxSession.TYPE_DATA -> {
                                        output.write(frame.payload)
                                        output.flush()
                                        bytesReceived.addAndGet(frame.payload.size.toLong())
                                    }
                                    MuxSession.TYPE_CLOSE -> break
                                }
                            }
                        } catch (_: Exception) {}
                        finally { mux.unsubscribeChannel(channelId) }
                    }

                    try {
                        while (running) {
                            val n = input.read(buf)
                            if (n < 0) break
                            mux.sendData(channelId, buf.copyOfRange(0, n))
                            bytesSent.addAndGet(n.toLong())
                        }
                    } catch (_: Exception) {}

                    mux.sendClose(channelId)
                    readThread.join(3000)
                } catch (_: Exception) {}
                try { clientSocket.close() } catch (_: Exception) {}
            }
        }

        private fun handleControlFrame(mux: MuxSession, frame: MuxFrame) {
            when (frame.type) {
                MuxSession.TYPE_CREATE -> {
                    Log.i(TAG, "Incoming channel create: ${String(frame.payload)}")
                }
                MuxSession.TYPE_CREATE_ACK -> {
                    Log.i(TAG, "Channel ack: success=${frame.payload.isNotEmpty() && frame.payload[0].toInt() == 1}")
                }
            }
        }
    }

    inner class ServerRunner(private val config: Map<String, Any?>) {
        @Volatile
        var running = false
            private set
        @Volatile
        var connectedClients: List<String> = emptyList()
            private set
        @Volatile
        var error: String? = null
            private set

        private var tunnelServer: TunnelServer? = null
        private var thread: Thread? = null

        fun start() {
            running = true
            thread = thread(isDaemon = false, name = "server-runner") {
                try {
                    val listenPort = (config["listenPort"] as? Number)?.toInt() ?: 33891
                    val password = config["password"] as? String ?: ""
                    val sni = config["sni"] as? String ?: "mail.qq.com"

                    val bindIp = config["bindIp"] as? String ?: "127.0.0.1"
                    val sslFactory: (() -> java.net.ServerSocket)? = {
                        TlsHelper.createServerSocket(this@TunnelService, listenPort, bindIp)
                    }
                    val server = TunnelServer(
                        listenPort, password, bindIp, sni,
                        onClientConnect = { clientId ->
                            connectedClients = connectedClients + clientId
                            this@TunnelService.emitAllStatus()
                        },
                        onClientDisconnect = { clientId ->
                            connectedClients = connectedClients - clientId
                            this@TunnelService.emitAllStatus()
                        },
                        serverSocketFactory = sslFactory
                    )
                    tunnelServer = server
                    server.start()
                    error = null

                    while (running && server.running) {
                        try { Thread.sleep(1000) } catch (_: InterruptedException) { break }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Server error: ${e.message}", e)
                    if (running) {
                        error = e.message ?: "服务器错误"
                    }
                } finally {
                    running = false
                    tunnelServer?.stop()
                    tunnelServer = null
                    this@TunnelService.serverRunners.remove(config["id"] as? String)
                    emitAllStatus()
                }
            }
        }

        fun stop() {
            running = false
            tunnelServer?.stop()
            tunnelServer = null
            thread?.join(3000)
            thread = null
        }
    }

    inner class ProxyRunner(private val config: Map<String, Any?>) {
        @Volatile
        var running = false
            private set
        @Volatile
        var error: String? = null
            private set

        private var proxy: Socks5Proxy? = null
        private var thread: Thread? = null

        fun start() {
            running = true
            thread = thread(isDaemon = false, name = "proxy-runner") {
                try {
                    val listenPort = (config["listenPort"] as? Number)?.toInt() ?: 1080
                    val typeStr = config["type"] as? String ?: "socks5"
                    val proxyType = if (typeStr == "http") ProxyType.HTTP else ProxyType.SOCKS5
                    val accounts = parseAccounts(config["accounts"])
                    val rules = parseRules(config["rules"])

                    val p = Socks5Proxy(
                        port = listenPort,
                        proxyType = proxyType,
                        accounts = accounts,
                        onForwardRequest = { _, _, _ -> },
                        rules = rules
                    )
                    proxy = p
                    p.start()
                    error = null

                    while (running && p.running) {
                        try { Thread.sleep(1000) } catch (_: InterruptedException) { break }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Proxy error: ${e.message}", e)
                    if (running) {
                        error = e.message ?: "代理错误"
                    }
                } finally {
                    running = false
                    proxy?.stop()
                    proxy = null
                    this@TunnelService.proxyRunners.remove(config["id"] as? String)
                    emitAllStatus()
                }
            }
        }

        fun stop() {
            running = false
            proxy?.stop()
            proxy = null
            thread?.join(3000)
            thread = null
        }
    }

    private fun acquireWakeLock() {
        try {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BiTunnel:KeepAlive")
            wakeLock?.acquire(4 * 60 * 60 * 1000L)
        } catch (_: Exception) {}
    }

    private fun releaseWakeLock() {
        try { wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Bi-Tunnel 后台服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "保持隧道后台运行"
                setShowBadge(false)
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun createNotification(text: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
        }
        return builder
            .setContentTitle("Bi-Tunnel")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification() {
        val clientCount = clientRunners.size
        val serverCount = serverRunners.size
        val proxyCount = proxyRunners.size
        val text = "客户端: $clientCount | 服务端: $serverCount | 代理: $proxyCount"
        try {
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIFICATION_ID, createNotification(text))
        } catch (_: Exception) {}
    }
}
