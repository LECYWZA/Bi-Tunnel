package com.bitunnel.mobile.service

import android.content.Context
import java.io.InputStream
import java.net.InetSocketAddress
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.*

object TlsHelper {

    private var serverContext: SSLContext? = null
    private val clientTrustAll = object : X509TrustManager {
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
        override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    fun getClientContext(): SSLContext {
        val ctx = SSLContext.getInstance("TLS")
        ctx.init(null, arrayOf(clientTrustAll), SecureRandom())
        return ctx
    }

    fun getServerContext(context: Context): SSLContext {
        serverContext?.let { return it }
        val certPem = context.resources.openRawResource(
            context.resources.getIdentifier("tunnel_cert", "raw", context.packageName)
        )
        val keyPem = context.resources.openRawResource(
            context.resources.getIdentifier("tunnel_key", "raw", context.packageName)
        )
        val ctx = createSSLContext(certPem, keyPem)
        serverContext = ctx
        return ctx
    }

    fun createClientSocket(host: String, port: Int, timeout: Int, sni: String): SSLSocket {
        val ctx = getClientContext()
        val s = ctx.socketFactory.createSocket() as SSLSocket
        s.connect(InetSocketAddress(host, port), timeout)
        s.soTimeout = timeout
        if (android.os.Build.VERSION.SDK_INT >= 24) {
            val p = s.sslParameters
            p.endpointIdentificationAlgorithm = ""
            p.serverNames = listOf(SNIHostName(sni))
            s.sslParameters = p
        }
        s.startHandshake()
        return s
    }

    fun createClientSocketDirect(host: String, port: Int, timeout: Int): java.net.Socket {
        val s = java.net.Socket()
        s.connect(InetSocketAddress(host, port), timeout)
        s.soTimeout = timeout
        return s
    }

    fun createServerSocket(context: Context, port: Int, bindIp: String?): SSLServerSocket {
        val ctx = getServerContext(context)
        val addr = bindIp?.takeIf { it.isNotBlank() && it != "0.0.0.0" }
            ?.let { InetSocketAddress(it, port) }
            ?: InetSocketAddress(port)
        val ss = ctx.serverSocketFactory.createServerSocket() as SSLServerSocket
        ss.bind(addr)
        return ss
    }

    private fun createSSLContext(certIn: InputStream, keyIn: InputStream): SSLContext {
        val certPem = certIn.readBytes().decodeToString()
        val keyPem = keyIn.readBytes().decodeToString()

        val cert = parsePemCertificate(certPem)
        val key = parsePemPrivateKey(keyPem)

        val ks = KeyStore.getInstance("PKCS12").apply { load(null, null) }
        ks.setKeyEntry("tunnel", key, "bitunnel".toCharArray(), arrayOf(cert))

        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, "bitunnel".toCharArray())

        val ctx = SSLContext.getInstance("TLS")
        ctx.init(kmf.keyManagers, arrayOf(clientTrustAll), SecureRandom())
        return ctx
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
