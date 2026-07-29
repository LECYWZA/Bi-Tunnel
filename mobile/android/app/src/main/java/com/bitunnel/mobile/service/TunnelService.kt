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
import com.bitunnel.mobile.mux.Socks5Proxy
import com.bitunnel.mobile.mux.TunnelServer
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
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

private data class PfRunnerInfo(val thread: Thread, val serverSocket: ServerSocket?)

class TunnelService : Service() {
    companion object {
        const val CHANNEL_ID = "bitunnel_service"
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
        const val ACTION_START_PORT_FORWARD = "com.bitunnel.mobile.START_PORT_FORWARD"
        const val ACTION_STOP_PORT_FORWARD = "com.bitunnel.mobile.STOP_PORT_FORWARD"

        val channelIdCounter = AtomicLong(1)

        fun handleProxyRequest(mux: MuxSession, targetHost: String, targetPort: Int, clientSocket: Socket) {
            val channelId = channelIdCounter.getAndAdd(2)
            val queue = mux.subscribeChannel(channelId)
            thread(isDaemon = true) {
                try {
                    mux.sendCreate(channelId, targetHost, targetPort)

                    // Wait for TYPE_CREATE_ACK before sending data
                    val ackTimeout = 15000L
                    val ackStart = System.currentTimeMillis()
                    var ackOk = false
                    while (System.currentTimeMillis() - ackStart < ackTimeout) {
                        val frame = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                        if (frame.type == MuxSession.TYPE_CREATE_ACK) {
                            ackOk = frame.payload.isNotEmpty() && frame.payload[0].toInt() == 1
                            break
                        }
                    }
                    if (!ackOk) {
                        mux.unsubscribeChannel(channelId)
                        clientSocket.close()
                        return@thread
                    }

                    val input = clientSocket.getInputStream()
                    val output = clientSocket.getOutputStream()
                    val buf = ByteArray(8192)
                    val readThread = thread(isDaemon = true) {
                        try {
                            while (true) {
                                val frame = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                                when (frame.type) {
                                    MuxSession.TYPE_DATA -> {
                                        output.write(frame.payload)
                                        output.flush()
                                    }
                                    MuxSession.TYPE_CLOSE -> break
                                }
                            }
                        } catch (_: Exception) {}
                        finally { mux.unsubscribeChannel(channelId) }
                    }
                    try {
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            mux.sendData(channelId, buf.copyOfRange(0, n))
                        }
                    } catch (_: Exception) {}
                    mux.sendClose(channelId)
                    readThread.join(3000)
                } catch (_: Exception) {}
                try { clientSocket.close() } catch (_: Exception) {}
            }
        }

        var statusCallback: ((Map<String, Any?>) -> Unit)? = null

        @Volatile
        var currentStatus: Map<String, Any?> = mapOf("state" to "disconnected")
            private set
    }

    private val clientRunners = ConcurrentHashMap<String, ClientRunner>()
    private val serverRunners = ConcurrentHashMap<String, ServerRunner>()
    private val proxyRunners = ConcurrentHashMap<String, ProxyRunner>()
    private val pfRunners = ConcurrentHashMap<String, MutableMap<String, PfRunnerInfo>>()
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service onCreate")
        try {
            createNotificationChannel()
            startForeground(NOTIFICATION_ID, createNotification("Bi-Tunnel", "后台服务运行中"))
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
        try {
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
                ACTION_START_PORT_FORWARD -> {
                    val id = intent.getStringExtra("instanceId") ?: return START_STICKY
                    val ruleJson = intent.getStringExtra("rule_json") ?: return START_STICKY
                    startPortForward(id, jsonToMap(ruleJson))
                }
                ACTION_STOP_PORT_FORWARD -> {
                    val id = intent.getStringExtra("instanceId") ?: return START_STICKY
                    val ruleId = intent.getStringExtra("ruleId") ?: return START_STICKY
                    stopPortForward(id, ruleId)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "onStartCommand error: ${e.message}")
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
        for ((_, runners) in pfRunners) {
            for ((_, info) in runners) {
                info.thread.interrupt()
                info.serverSocket?.close()
            }
        }
        pfRunners.clear()
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
        pfRunners.remove(id)?.values?.forEach { it.thread.interrupt(); it.serverSocket?.close() }
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
        pfRunners.remove(id)?.values?.forEach { it.thread.interrupt(); it.serverSocket?.close() }
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

    private fun startPortForward(instanceId: String, rule: Map<String, Any?>) {
        val ruleId = rule["id"] as? String ?: return
        if (rule["targetClientId"] is String) {
            Log.w(TAG, "Server-side PF rules not yet supported for standalone toggle")
            return
        }
        val clientRunner = clientRunners[instanceId] ?: run {
            Log.w(TAG, "startPortForward: no client runner found for $instanceId")
            return
        }
        val mux = clientRunner.getSession() ?: return
        stopPortForward(instanceId, ruleId)
        val pfListenPort = (rule["listenPort"] as? Number)?.toInt() ?: return
        val pfTargetHost = rule["targetHost"] as? String ?: return
        val pfTargetPort = (rule["targetPort"] as? Number)?.toInt() ?: return
        val ss: ServerSocket
        try {
            ss = ServerSocket(pfListenPort, 50, java.net.InetAddress.getByName("127.0.0.1"))
        } catch (e: Exception) {
            Log.e(TAG, "startPortForward: failed to bind port $pfListenPort: ${e.message}")
            return
        }
        val t = thread(isDaemon = true, name = "pf-$instanceId-$ruleId") {
            try {
                while (pfRunners[instanceId]?.containsKey(ruleId) == true) {
                    try {
                        val client = ss.accept()
                        TunnelService.handleProxyRequest(mux, pfTargetHost, pfTargetPort, client)
                    } catch (_: Exception) {
                        if (pfRunners[instanceId]?.containsKey(ruleId) != true) break
                    }
                }
            } catch (_: Exception) {}
        }
        pfRunners.getOrPut(instanceId) { mutableMapOf() }[ruleId] = PfRunnerInfo(t, ss)
    }

    private fun stopPortForward(instanceId: String, ruleId: String) {
        val info = pfRunners[instanceId]?.remove(ruleId) ?: return
        info.thread.interrupt()
        info.serverSocket?.close()
    }

    private fun parseRules(raw: Any?): List<ProxyRule> {
        val rawList = raw as? List<Map<String, Any?>> ?: return emptyList()
        return rawList.mapNotNull { r ->
            try {
                ProxyRule(
                    matchType = r["matchType"] as? String ?: "any",
                    matchValue = r["matchValue"] as? String ?: "",
                    enabled = r["enabled"] as? Boolean ?: true,
                    action = r["action"] as? String ?: "forward"
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
        if (obj == org.json.JSONObject.NULL) return null
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
                    var reconnectAttempt = 0
                    while (running) {
                        var mux: MuxSession? = null
                        try {
                            val host = config["serverHost"] as? String ?: throw Exception("Missing serverHost")
                            val port = (config["serverPort"] as? Number)?.toInt() ?: 33891
                            val password = config["password"] as? String ?: ""
                            val clientId = config["clientId"] as? String ?: "mobile-1"
                            val sni = config["sni"] as? String ?: "mail.qq.com"
                            val proxyPort = (config["localProxyPort"] as? Number)?.toInt() ?: 1080
                            val rules = parseRules(config["rules"])

                            Log.i(TAG, "Client $clientId connecting to $host:$port (attempt ${reconnectAttempt + 1})")
                            status = "connecting"
                            this@TunnelService.emitAllStatus()

                            val socket = TlsHelper.createClientSocket(host, port, 15000, sni)

                            val input: InputStream = socket.getInputStream()
                            val output: OutputStream = socket.getOutputStream()

                            mux = MuxSession(input, output, password)
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
                            reconnectAttempt = 0

                            proxy = Socks5Proxy(
                                port = proxyPort,
                                onForwardRequest = { targetHost, targetPort, clientSocket ->
                                    val s = this.session
                                    if (s != null) {
                                        TunnelService.handleProxyRequest(s, targetHost, targetPort, clientSocket)
                                    }
                                },
                                rules = rules,
                                defaultAction = "forward"
                            )
                            proxy?.start()

                            mux.startReader { frame -> handleControlFrame(mux, frame) }

                            // Restart port forwards with the new session after reconnect
                            try {
                                val instanceId = config["id"] as? String ?: ""
                                val pfRules = config["portForwards"] as? List<Map<String, Any?>> ?: emptyList()
                                for (pf in pfRules) {
                                    if (pf["enabled"] == true) {
                                        this@TunnelService.startPortForward(instanceId, pf)
                                    }
                                }
                            } catch (_: Exception) {}

                            while (running) {
                                if (mux.isClosed) {
                                    Log.w(TAG, "Client $clientId connection lost")
                                    throw java.io.IOException("Connection lost")
                                }
                                try { Thread.sleep(1000) } catch (_: InterruptedException) { throw java.io.IOException("Stopped") }
                            }

                            break

                        } catch (e: Exception) {
                            if (!running) break

                            reconnectAttempt++
                            val message = e.message ?: "unknown"
                            Log.e(TAG, "Client error: $message (attempt $reconnectAttempt)")

                            if (running) {
                                status = "reconnecting"
                                error = null
                                this@TunnelService.emitAllStatus()
                            }

                            proxy?.stop()
                            proxy = null
                            try { session?.close() } catch (_: Exception) {}
                            session = null
                            // Stop stale port forwards holding the old session
                            val instanceId = config["id"] as? String ?: ""
                            this@TunnelService.pfRunners.remove(instanceId)?.values?.forEach {
                                it.thread.interrupt(); it.serverSocket?.close()
                            }

                            val delay = minOf(1000L * (1 shl (reconnectAttempt - 1)), 30000L)
                            val deadline = System.currentTimeMillis() + delay
                            while (running && System.currentTimeMillis() < deadline) {
                                try { Thread.sleep(minOf(1000L, deadline - System.currentTimeMillis())) }
                                catch (_: InterruptedException) { break }
                            }
                        }
                    }
                } finally {
                    running = false
                    status = "disconnected"
                    proxy?.stop()
                    proxy = null
                    try { session?.close() } catch (_: Exception) {}
                    session = null
                    val instanceId = config["id"] as? String ?: ""
                    this@TunnelService.pfRunners.remove(instanceId)?.values?.forEach {
                        it.thread.interrupt(); it.serverSocket?.close()
                    }
                    this@TunnelService.clientRunners.remove(instanceId)
                    emitAllStatus()
                }
            }
        }

        fun getSession(): MuxSession? = session

        fun stop() {
            running = false
            proxy?.stop()
            proxy = null
            try { session?.close() } catch (_: Exception) {}
            session = null
            thread?.interrupt()
            thread?.join(3000)
            thread = null
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

        fun getSession(): MuxSession? = null

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
                    val accounts = parseAccounts(config["accounts"])
                    val rules = parseRules(config["rules"])

                    val p = Socks5Proxy(
                        port = listenPort,
                        accounts = accounts,
                        onForwardRequest = { _, _, _ -> },
                        rules = rules,
                        defaultAction = config["defaultAction"] as? String ?: "forward"
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
            wakeLock?.acquire()
        } catch (_: Exception) {}
    }

    private fun releaseWakeLock() {
        try { wakeLock?.release() } catch (_: Exception) {}
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Bi-Tunnel 后台服务",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "保持隧道后台运行，连接状态实时显示"
                setShowBadge(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                enableVibration(false)
                setSound(null, null)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun createNotification(title: String, text: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
        }
        return builder
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    private fun updateNotification() {
        val title: String
        val text: String
        val client = clientRunners.values.firstOrNull()
        if (client != null) {
            when (client.status) {
                "connected" -> {
                    title = "Bi-Tunnel · 已连接"
                    text = "客户端运行中，点击查看详情"
                }
                "connecting" -> {
                    title = "Bi-Tunnel · 连接中"
                    text = "正在连接服务器..."
                }
                "reconnecting" -> {
                    title = "Bi-Tunnel · 重连中"
                    text = "连接已断开，正在自动重连..."
                }
                "failed" -> {
                    title = "Bi-Tunnel · 连接失败"
                    text = "错误: ${client.error ?: "未知错误"}"
                }
                else -> {
                    title = "Bi-Tunnel"
                    text = "客户端已断开"
                }
            }
        } else if (serverRunners.isNotEmpty()) {
            title = "Bi-Tunnel · 服务端运行中"
            text = "服务端: ${serverRunners.size} 个"
        } else if (proxyRunners.isNotEmpty()) {
            title = "Bi-Tunnel · 代理运行中"
            text = "代理: ${proxyRunners.size} 个"
        } else {
            title = "Bi-Tunnel"
            text = "后台服务运行中"
        }
        try {
            val nm = getSystemService(NotificationManager::class.java)
            nm.notify(NOTIFICATION_ID, createNotification(title, text))
        } catch (_: Exception) {}
    }
}
