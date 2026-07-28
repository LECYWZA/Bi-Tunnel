package com.bitunnel.mobile.mux

import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

enum class RuleAction { FORWARD, DIRECT, REJECT }
enum class ProxyType { SOCKS5, HTTP }

data class ProxyRule(
    val matchType: String,
    val matchValue: String,
    val action: RuleAction,
    val enabled: Boolean = true
)

data class ProxyAccount(
    val username: String,
    val password: String,
    val enabled: Boolean = true
)

class Socks5Proxy(
    private val port: Int,
    private val proxyType: ProxyType = ProxyType.SOCKS5,
    private val accounts: List<ProxyAccount> = emptyList(),
    private val onForwardRequest: (host: String, port: Int, clientSocket: Socket) -> Unit,
    private val onDirectRequest: ((host: String, port: Int, clientSocket: Socket) -> Unit)? = null,
    private val rules: List<ProxyRule> = emptyList()
) {
    private var serverSocket: ServerSocket? = null
    @Volatile
    var running = false
        private set

    private val useAuth: Boolean get() = accounts.isNotEmpty() && accounts.any { it.enabled }

    fun start() {
        running = true
        thread(isDaemon = true, name = "proxy-${port}") {
            try {
                val ss = ServerSocket()
                serverSocket = ss
                ss.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
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
        try { serverSocket?.close() } catch (_: Exception) {}
    }

    private fun handleClient(socket: Socket) {
        try {
            when (proxyType) {
                ProxyType.SOCKS5 -> handleSocks5(socket)
                ProxyType.HTTP -> handleHttp(socket)
            }
        } catch (_: Exception) {
            try { socket.close() } catch (_: Exception) {}
        }
    }

    private fun handleSocks5(socket: Socket) {
        val input = socket.getInputStream()
        val output = socket.getOutputStream()

        val buf = ByteArray(4096)
        var n = input.read(buf)
        if (n < 3 || buf[0].toInt() != 0x05) {
            socket.close()
            return
        }

        val nmethods = buf[1].toInt()
        val methods = (2 until 2 + nmethods).map { buf[it].toInt() }

        if (useAuth) {
            if (methods.any { it == 0x02 }) {
                output.write(byteArrayOf(0x05, 0x02))
                output.flush()

                n = input.read(buf)
                if (n < 5 || buf[0].toInt() != 0x01) {
                    output.write(byteArrayOf(0x01, 0x01))
                    socket.close()
                    return
                }
                val ulen = buf[1].toInt()
                val uname = String(buf, 2, ulen)
                val plen = buf[2 + ulen].toInt()
                val pass = String(buf, 3 + ulen, plen)

                val ok = accounts.any { it.enabled && it.username == uname && it.password == pass }
                if (!ok) {
                    output.write(byteArrayOf(0x01, 0x01))
                    socket.close()
                    return
                }
                output.write(byteArrayOf(0x01, 0x00))
                output.flush()
            } else {
                output.write(byteArrayOf(0x05, (-1).toByte()))
                socket.close()
                return
            }
        } else {
            if (methods.any { it == 0x00 }) {
                output.write(byteArrayOf(0x05, 0x00))
                output.flush()
            } else {
                output.write(byteArrayOf(0x05, (-1).toByte()))
                socket.close()
                return
            }
        }

        n = input.read(buf)
        if (n < 4 || buf[0].toInt() != 0x05 || buf[1].toInt() != 0x01) {
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

        val action = evaluateRules(host)
        when (action) {
            RuleAction.REJECT -> {
                val reply = byteArrayOf(0x05, 0x02.toByte(), 0x00, 0x01, 0, 0, 0, 0, 0, 0)
                output.write(reply)
                output.flush()
                socket.close()
            }
            RuleAction.DIRECT -> {
                val reply = byteArrayOf(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0)
                output.write(reply)
                output.flush()
                if (onDirectRequest != null) {
                    onDirectRequest(host, port, socket)
                } else {
                    directConnect(host, port, socket)
                }
            }
            RuleAction.FORWARD -> {
                val reply = byteArrayOf(0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0)
                output.write(reply)
                output.flush()
                onForwardRequest(host, port, socket)
            }
        }
    }

    private fun handleHttp(socket: Socket) {
        val input = socket.getInputStream()
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
                    it.enabled && it.username == parts[0] && it.password == parts[1]
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
            val port = hostPort.substringAfter(":").toIntOrNull() ?: 443
            val action = evaluateRules(host)
            when (action) {
                RuleAction.REJECT -> {
                    output.write("HTTP/1.1 403 Forbidden\r\n\r\n".toByteArray())
                    output.flush()
                    socket.close()
                }
                RuleAction.DIRECT -> {
                    output.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
                    output.flush()
                    if (onDirectRequest != null) onDirectRequest(host, port, socket)
                    else directConnect(host, port, socket)
                }
                RuleAction.FORWARD -> {
                    output.write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
                    output.flush()
                    onForwardRequest(host, port, socket)
                }
            }
        } else {
            val parts = request.lines().first().split(" ")
            if (parts.size < 2) { socket.close(); return }
            val url = parts[1]
            val uri = java.net.URI(url)
            val host = uri.host ?: run { socket.close(); return }
            val targetPort = uri.port.takeIf { it > 0 } ?: 80
            val action = evaluateRules(host)
            when (action) {
                RuleAction.REJECT -> {
                    output.write("HTTP/1.1 403 Forbidden\r\n\r\n".toByteArray())
                    output.flush()
                    socket.close()
                }
                RuleAction.DIRECT -> {
                    if (onDirectRequest != null) onDirectRequest(host, targetPort, socket)
                    else directConnect(host, targetPort, socket)
                }
                RuleAction.FORWARD -> {
                    onForwardRequest(host, targetPort, socket)
                }
            }
        }
    }

    private fun evaluateRules(host: String): RuleAction {
        for (rule in rules) {
            if (!rule.enabled) continue
            val patterns = rule.matchValue.split("\n").map { it.trim() }.filter { it.isNotEmpty() }
            val matches = when (rule.matchType) {
                "any" -> true
                "domain" -> patterns.any { matchesGlob(host, it.trimStart('.')) }
                "ip" -> patterns.any { it == host }
                "cidr" -> patterns.any { matchesCIDR(host, it) }
                else -> false
            }
            if (matches) return rule.action
        }
        return RuleAction.FORWARD
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
        thread(isDaemon = true) {
            var remote: Socket? = null
            try {
                remote = Socket()
                remote.connect(InetSocketAddress(host, port), 15000)
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
            } catch (_: Exception) {
            } finally {
                try { remote?.close() } catch (_: Exception) {}
                try { clientSocket.close() } catch (_: Exception) {}
            }
        }
    }
}
