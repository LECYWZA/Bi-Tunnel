package com.bitunnel.mobile.service

import android.content.Context
import android.util.Log
import java.io.InputStream
import java.net.InetSocketAddress
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.*

object TlsHelper {
    private const val TAG = "TlsHelper"

    private var serverContext: SSLContext? = null
    private val clientTrustAll = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    private fun sslContext(km: Array<KeyManager>? = null): SSLContext {
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(km, arrayOf(clientTrustAll), SecureRandom())
        return ctx
    }

    private fun configSocket(s: SSLSocket, sni: String) {
        s.soTimeout = 15000
        val p = s.sslParameters
        p.endpointIdentificationAlgorithm = ""
        if (android.os.Build.VERSION.SDK_INT >= 24 && sni.isNotEmpty()) {
            p.serverNames = listOf(SNIHostName(sni))
        }
        @Suppress("DEPRECATION")
        s.enabledProtocols = s.supportedProtocols.filter { it.startsWith("TLSv1") || it.startsWith("TLSv1.") }.toTypedArray()
        s.sslParameters = p
    }

    fun createClientSocket(host: String, port: Int, timeout: Int, sni: String): SSLSocket {
        val ctx = sslContext()
        val s = ctx.socketFactory.createSocket() as SSLSocket
        s.connect(InetSocketAddress(host, port), timeout)
        configSocket(s, sni)
        s.startHandshake()
        Log.i(TAG, "TLS client connected to $host:$port sni=$sni")
        return s
    }

    fun createServerSocket(context: Context, port: Int, bindIp: String?): SSLServerSocket {
        val ctx = serverContext ?: run {
            val certId = context.resources.getIdentifier("tunnel_cert", "raw", context.packageName)
            val keyId = context.resources.getIdentifier("tunnel_key", "raw", context.packageName)
            if (certId == 0 || keyId == 0) throw IllegalStateException("TLS cert/key not found in raw resources")
            context.resources.openRawResource(certId).use { certIn ->
                context.resources.openRawResource(keyId).use { keyIn ->
                    val certPem = certIn.readBytes().decodeToString()
                    val keyPem = keyIn.readBytes().decodeToString()

                    val cert = parsePemCertificate(certPem)
                    val key = parsePemPrivateKey(keyPem)

                    val ks = KeyStore.getInstance("PKCS12").apply { load(null, null) }
                    ks.setKeyEntry("tunnel", key, "bitunnel".toCharArray(), arrayOf(cert))

                    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
                    kmf.init(ks, "bitunnel".toCharArray())

                    sslContext(kmf.keyManagers).also { serverContext = it }
                }
            }
        }
        val addr = bindIp?.takeIf { it.isNotBlank() && it != "0.0.0.0" }
            ?.let { InetSocketAddress(it, port) }
            ?: InetSocketAddress(port)
        val ss = ctx.serverSocketFactory.createServerSocket() as SSLServerSocket
        @Suppress("DEPRECATION")
        ss.enabledProtocols = ss.supportedProtocols.filter { it.startsWith("TLSv1") || it.startsWith("TLSv1.") }.toTypedArray()
        ss.bind(addr)
        Log.i(TAG, "TLS server listening on $addr")
        return ss
    }

    private fun parsePemCertificate(pem: String): X509Certificate {
        val b64 = pem.lines()
            .dropWhile { it.startsWith("-----") }
            .takeWhile { !it.startsWith("-----") }
            .joinToString("")
        val der = java.util.Base64.getDecoder().decode(b64)
        val cf = CertificateFactory.getInstance("X.509")
        return cf.generateCertificate(der.inputStream()) as X509Certificate
    }

    private fun parsePemPrivateKey(pem: String): java.security.PrivateKey {
        val b64 = pem.lines()
            .dropWhile { it.startsWith("-----") }
            .takeWhile { !it.startsWith("-----") }
            .joinToString("")
        val der = java.util.Base64.getDecoder().decode(b64)
        val kf = java.security.KeyFactory.getInstance("RSA")
        val spec = java.security.spec.PKCS8EncodedKeySpec(der)
        return kf.generatePrivate(spec)
    }
}
