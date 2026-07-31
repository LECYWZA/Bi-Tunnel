package com.bitunnel.mobile.mux

import android.util.Log
import java.io.InputStream
import java.io.PushbackInputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

data class ProxyRule(
    val matchType: String,
    val matchValue: String,
    val enabled: Boolean = true,
    val action: String = "forward"
)

data class ProxyAccount(
    val username: String,
    val password: String,
    val enabled: Boolean = true
)

class Socks5Proxy(
    private val port: Int,
    private val accounts: List<ProxyAccount> = emptyList(),
    private val onForwardRequest: (host: String, port: Int, clientSocket: Socket) -> Unit,
    private val onDirectRequest: ((host: String, port: Int, clientSocket: Socket) -> Unit)? = null,
    private val rules: List<ProxyRule> = emptyList(),
    private val defaultAction: String = "forward",
    private val onError: ((String) -> Unit)? = null
) {
    private val TAG = "Socks5Proxy"
    private var serverSocket: ServerSocket? = null
    private val clientSockets = java.util.concurrent.ConcurrentHashMap.newKeySet<Socket>()
    @Volatile
    var running = false
        private set

    private val useAuth: Boolean get() = accounts.isNotEmpty() && accounts.any { it.username.isNotEmpty() }

    fun start() {
        running = true
        System.out.println("Socks5Proxy start: port=$port")
        thread(isDaemon = true, name = "proxy-${port}") {
            try {
                val ss = ServerSocket()
                serverSocket = ss
                ss.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
                System.out.println("Socks5Proxy bound: port=$port")
                while (running) {
                    try {
                        val client = ss.accept()
                        System.out.println("Socks5Proxy accept: from ${client.remoteSocketAddress}")
                        clientSockets.add(client)
                        thread(isDaemon = true) {
                            try {
                                handleClient(client)
                            } finally {
                                clientSockets.remove(client)
                            }
                        }
                    } catch (_: Exception) {
                        if (!running) break
                    }
                }
            } catch (e: Exception) {
                System.out.println("Socks5Proxy start error: ${e.message}")
                onError?.invoke(e.message ?: "bind failed")
                running = false
            }
        }
    }

    fun stop() {
        running = false
        try { serverSocket?.close() } catch (_: Exception) {}
        // 关闭所有已建立的连接，避免停止后 keep-alive 连接仍可复用
        for (s in clientSockets) {
            try { s.close() } catch (_: Exception) {}
        }
        clientSockets.clear()
    }

    private fun handleClient(socket: Socket) {
        System.out.println("Socks5Proxy handleClient")
        try {
            val input = socket.getInputStream()
            val pushback = PushbackInputStream(input, 1)
            val firstByte = pushback.read()
            System.out.println("Socks5Proxy firstByte=$firstByte")
            if (firstByte < 0) { socket.close(); return }
            pushback.unread(firstByte)
            when {
                firstByte == 0x05 -> handleSocks5(socket, pushback)
                firstByte in listOf('G'.code, 'P'.code, 'H'.code, 'C'.code, 'D'.code, 'O'.code) ->
                    handleHttp(socket, pushback)
                else -> socket.close()
            }
        } catch (e: Exception) {
            System.out.println("Socks5Proxy handleClient error: $e")
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun handleSocks5(socket: Socket, input: PushbackInputStream) {
        System.out.println("Socks5Proxy handleSocks5 entry")
        val output = socket.getOutputStream()
        Log.i(TAG, "handleSocks5: start")

        val buf = ByteArray(4096)
        var n = input.read(buf)
        if (n < 3 || buf[0].toInt() != 0x05) {
            Log.i(TAG, "handleSocks5: bad version n=$n first=${buf[0].toInt()}")
            socket.close()
            return
        }

        val nmethods = buf[1].toInt()
        val methods = (2 until 2 + nmethods).map { buf[it].toInt() }
        Log.i(TAG, "handleSocks5: nmethods=$nmethods methods=$methods useAuth=$useAuth accounts=${accounts.size}")

        if (useAuth) {
            if (methods.any { it == 0x02 }) {
                output.write(byteArrayOf(0x05, 0x02))
                output.flush()
                Log.i(TAG, "handleSocks5: sent method=0x02, waiting auth...")

                n = input.read(buf)
                Log.i(TAG, "handleSocks5: auth read n=$n first=${if (n>0) buf[0].toInt() else -1}")
                if (n < 5 || buf[0].toInt() != 0x01) {
                    Log.i(TAG, "handleSocks5: bad auth")
                    output.write(byteArrayOf(0x01, 0x01))
                    socket.close()
                    return
                }
                val ulen = buf[1].toInt()
                val uname = String(buf, 2, ulen)
                val plen = buf[2 + ulen].toInt()
                val pass = String(buf, 3 + ulen, plen)
                Log.i(TAG, "handleSocks5: auth uname='$uname' pass='$pass'")

                val ok = accounts.any { it.username == uname && it.password == pass }
                Log.i(TAG, "handleSocks5: auth ok=$ok")
                if (!ok) {
                    output.write(byteArrayOf(0x01, 0x01))
                    socket.close()
                    return
                }
                output.write(byteArrayOf(0x01, 0x00))
                output.flush()
                Log.i(TAG, "handleSocks5: auth success sent")
            } else {
                Log.i(TAG, "handleSocks5: no auth method found")
                output.write(byteArrayOf(0x05, (-1).toByte()))
                socket.close()
                return
            }
        } else {
            if (methods.any { it == 0x00 }) {
                output.write(byteArrayOf(0x05, 0x00))
                output.flush()
                Log.i(TAG, "handleSocks5: no auth needed")
            } else {
                output.write(byteArrayOf(0x05, (-1).toByte()))
                socket.close()
                return
            }
        }

        n = input.read(buf)
        Log.i(TAG, "handleSocks5: connect read n=$n first=${if (n>0) buf[0].toInt() else -1}")
        if (n < 4 || buf[0].toInt() != 0x05 || buf[1].toInt() != 0x01) {
            Log.i(TAG, "handleSocks5: bad connect request n=$n v=${if(n>0)buf[0].toInt() else -1} cmd=${if(n>1)buf[1].toInt() else -1}")
            socket.close()
            return
        }

        val atyp = buf[3].toInt()
        val (host, port, _) = when (atyp) {
            0x01 -> {
                if (n < 10) { socket.close(); return }
                val ip = (0..3).map { buf[4 + it].toInt() and 0xFF }.joinToString(".")
                Triple(ip, ((buf[8].toInt() and 0xFF) shl 8) or (buf[9].toInt() and 0xFF), 0)
            }
            0x03 -> {
                val domainLen = buf[4].toInt()
                if (n < 5 + domainLen + 2) { socket.close(); return }
                val domain = String(buf, 5, domainLen)
                val p = ((buf[5 + domainLen].toInt() and 0xFF) shl 8) or (buf[6 + domainLen].toInt() and 0xFF)
                Triple(domain, p, 0)
            }
            0x04 -> {
                if (n < 22) { socket.close(); return }
                val parts = (0 until 16 step 2).map {
                    String.format("%02x%02x", buf[4 + it], buf[5 + it])
                }
                val ip = parts.joinToString(":")
                val p = ((buf[20].toInt() and 0xFF) shl 8) or (buf[21].toInt() and 0xFF)
                Triple(ip, p, 0)
            }
            else -> { socket.close(); return }
        }
        Log.i(TAG, "handleSocks5: connect host=$host port=$port")

        val resolvedAction = evaluateRules(host) ?: defaultAction
        Log.i(TAG, "handleSocks5: action=$resolvedAction")
        when (resolvedAction) {
            "reject" -> {
                val reply = byteArrayOf(0x05, 0x02.toByte(), 0x00, 0x01, 0, 0, 0, 0, 0, 0)
                output.write(reply)
                output.flush()
                socket.close()
            }
            "direct" -> {
                val reply = byteArrayOf(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0)
                output.write(reply)
                output.flush()
                Log.i(TAG, "handleSocks5: direct connect to $host:$port")
                if (onDirectRequest != null) {
                    onDirectRequest(host, port, socket)
                } else {
                    directConnect(host, port, socket)
                }
            }
            else -> {
                val reply = byteArrayOf(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0)
                output.write(reply)
                output.flush()
                Log.i(TAG, "handleSocks5: forward to $host:$port")
                onForwardRequest(host, port, socket)
            }
        }
    }

    private fun handleHttp(socket: Socket, input: PushbackInputStream) {
        val output = socket.getOutputStream()
        val buf = ByteArray(8192)
        var n = input.read(buf)
        if (n < 4) {
            socket.close()
            return
        }

        val request = String(buf, 0, n)

        if (useAuth) {
            val authHeader = request.lines().find { it.startsWith("Proxy-Authorization:", true) }
            val authorized = if (authHeader != null) {
                val encoded = authHeader.substringAfter("Basic ").trim()
                val decoded = String(java.util.Base64.getDecoder().decode(encoded))
                val parts = decoded.split(":", limit = 2)
                parts.size == 2 && accounts.any {
                    it.username == parts[0] && it.password == parts[1]
                }
            } else false

            if (!authorized) {
                output.write("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Bi-Tunnel\"\r\n\r\n".toByteArray())
                output.flush()
                socket.close()
                return
            }
        }

        val isConnect = request.startsWith("CONNECT", ignoreCase = true)
        if (isConnect) {
            val parts = request.lines().first().split(" ")
            if (parts.size < 2) { socket.close(); return }
            val hostPort = parts[1]
            val host = hostPort.substringBefore(":")
            val p = hostPort.substringAfter(":").toIntOrNull() ?: 443
            val resolvedAction = evaluateRules(host) ?: defaultAction
            when (resolvedAction) {
                "reject" -> {
                    output.write("HTTP/1.1 403 Forbidden\r\n\r\n".toByteArray())
                    output.flush()
                    socket.close()
                }
                "direct" -> {
                    output.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
                    output.flush()
                    if (onDirectRequest != null) onDirectRequest(host, p, socket)
                    else directConnect(host, p, socket)
                }
                else -> {
                    output.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
                    output.flush()
                    onForwardRequest(host, p, socket)
                }
            }
        } else {
            val parts = request.lines().first().split(" ")
            if (parts.size < 2) { socket.close(); return }
            val url = parts[1]
            val uri = java.net.URI(url)
            val host = uri.host ?: run { socket.close(); return }
            val targetPort = uri.port.takeIf { it > 0 } ?: 80
            val resolvedAction = evaluateRules(host) ?: defaultAction
            when (resolvedAction) {
                "reject" -> {
                    output.write("HTTP/1.1 403 Forbidden\r\n\r\n".toByteArray())
                    output.flush()
                    socket.close()
                }
                "direct" -> {
                    if (onDirectRequest != null) onDirectRequest(host, targetPort, socket)
                    else directConnect(host, targetPort, socket)
                }
                else -> {
                    onForwardRequest(host, targetPort, socket)
                }
            }
        }
    }

    private fun evaluateRules(host: String): String? {
        for (rule in rules) {
            if (!rule.enabled) continue
            val patterns = rule.matchValue.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            val matches = when (rule.matchType) {
                "any" -> true
                "auto" -> patterns.any { pattern ->
                    when {
                        pattern == "any" || pattern == "*" || pattern == "all" || pattern == "0.0.0.0/0" || pattern == "::/0" -> true
                        pattern.contains("/") -> matchesCIDR(host, pattern)
                        pattern.any { it.isLetter() || it == '*' || it == '?' } -> matchesGlob(host, pattern.trimStart('.'))
                        pattern.all { it.isDigit() || it == '.' } -> host == pattern
                        else -> host == pattern
                    }
                }
                "domain" -> patterns.any { matchesGlob(host, it.trimStart('.')) }
                "ip" -> patterns.any { it == host }
                "cidr" -> patterns.any { matchesCIDR(host, it) }
                else -> false
            }
            if (matches) return rule.action
        }
        return null
    }

    private fun matchesGlob(host: String, pattern: String): Boolean {
        var p = 0
        var h = 0
        var starP = -1
        var starH = 0
        while (h < host.length) {
            if (p < pattern.length && (pattern[p] == host[h] || pattern[p] == '?')) {
                p++; h++
            } else if (p < pattern.length && pattern[p] == '*') {
                starP = p
                starH = h
                p++
            } else if (starP >= 0) {
                p = starP + 1
                starH++
                h = starH
            } else {
                return false
            }
        }
        while (p < pattern.length && pattern[p] == '*') p++
        return p == pattern.length
    }

    private fun matchesCIDR(host: String, cidr: String): Boolean {
        val parts = cidr.split("/")
        if (parts.size != 2) return false
        return try {
            val prefixLen = parts[1].toInt()
            val ip = InetAddress.getByName(host).address
            val cidrAddr = InetAddress.getByName(parts[0]).address
            val fullBytes = prefixLen / 8
            val remainingBits = prefixLen % 8

            for (i in 0 until fullBytes) {
                if (ip[i] != cidrAddr[i]) return false
            }

            if (remainingBits > 0 && fullBytes < ip.size) {
                val ipByte = ip[fullBytes].toInt() and 0xFF
                val cidrByte = cidrAddr[fullBytes].toInt() and 0xFF
                val mask = (0xFF shl (8 - remainingBits)) and 0xFF
                return (ipByte and mask) == (cidrByte and mask)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun directConnect(host: String, port: Int, clientSocket: Socket) {
        System.out.println("Socks5Proxy directConnect: start host=$host port=$port")
        thread(isDaemon = true) {
            var remote: Socket? = null
            try {
                System.out.println("Socks5Proxy directConnect: resolving DNS for $host")
                val addrFuture = FutureTask { InetAddress.getByName(host) }
                Thread(addrFuture).apply { isDaemon = true; start() }
                val addr = try {
                    addrFuture.get(10, TimeUnit.SECONDS)
                } catch (e: Exception) {
                    System.out.println("Socks5Proxy directConnect: DNS error: ${e.javaClass.simpleName} $e")
                    throw java.net.UnknownHostException("DNS failed for $host: $e")
                }
                System.out.println("Socks5Proxy directConnect: DNS resolved $host -> ${addr.hostAddress}")
                remote = Socket()
                System.out.println("Socks5Proxy directConnect: connecting to ${addr.hostAddress}:$port")
                remote.connect(InetSocketAddress(addr, port), 15000)
                System.out.println("Socks5Proxy directConnect: connected to ${addr.hostAddress}:$port")
                remote.soTimeout = 30000
                val remoteInput = remote.getInputStream()
                val remoteOutput = remote.getOutputStream()
                val clientInput = clientSocket.getInputStream()
                val clientOutput = clientSocket.getOutputStream()

                val toRemote = thread(isDaemon = true) {
                    val buf = ByteArray(8192)
                    try {
                        while (true) {
                            val n = clientInput.read(buf)
                            if (n < 0) break
                            remoteOutput.write(buf, 0, n)
                            remoteOutput.flush()
                        }
                    } catch (_: Exception) {}
                }

                val toClient = thread(isDaemon = true) {
                    val buf = ByteArray(8192)
                    try {
                        while (true) {
                            val n = remoteInput.read(buf)
                            if (n < 0) break
                            clientOutput.write(buf, 0, n)
                            clientOutput.flush()
                        }
                    } catch (_: Exception) {}
                }

                toRemote.join()
                try { remote.shutdownOutput() } catch (_: Exception) {}
                toClient.join()
                System.out.println("Socks5Proxy directConnect: done")
            } catch (e: Exception) {
                System.out.println("Socks5Proxy directConnect: error ${e.javaClass.simpleName}: $e")
            } finally {
                try { remote?.close() } catch (_: Exception) {}
                try { clientSocket.close() } catch (_: Exception) {}
                System.out.println("Socks5Proxy directConnect: closed client socket")
            }
        }
    }
}