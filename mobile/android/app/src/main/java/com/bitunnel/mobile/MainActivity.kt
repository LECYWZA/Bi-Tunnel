package com.bitunnel.mobile

import android.os.Bundle
import com.bitunnel.mobile.service.TunnelPlugin
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private var tunnelPlugin: TunnelPlugin? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        tunnelPlugin = TunnelPlugin(this, flutterEngine)
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        tunnelPlugin?.dispose()
        tunnelPlugin = null
        super.cleanUpFlutterEngine(flutterEngine)
    }
}
