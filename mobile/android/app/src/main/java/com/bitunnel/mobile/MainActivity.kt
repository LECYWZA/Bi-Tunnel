package com.bitunnel.mobile

import android.os.Bundle
import com.bitunnel.mobile.service.TunnelPlugin
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var tunnelPlugin: TunnelPlugin? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        if (tunnelPlugin == null) {
            tunnelPlugin = TunnelPlugin(this, flutterEngine)
        }
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        // Don't dispose tunnelPlugin here — it would kill status stream
        // Only null the reference, keep the native event channel connected
        super.cleanUpFlutterEngine(flutterEngine)
    }

    override fun onDestroy() {
        tunnelPlugin?.dispose()
        tunnelPlugin = null
        super.onDestroy()
    }
}