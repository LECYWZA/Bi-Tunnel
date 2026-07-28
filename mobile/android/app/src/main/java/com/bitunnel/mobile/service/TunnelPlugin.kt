package com.bitunnel.mobile.service

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import org.json.JSONArray
import org.json.JSONObject

class TunnelPlugin(private val context: Context, private val flutterEngine: FlutterEngine) {

    private val methodChannel: MethodChannel
    private val eventChannel: EventChannel

    init {
        methodChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.bitunnel.mobile/tunnel")
        eventChannel = EventChannel(flutterEngine.dartExecutor.binaryMessenger, "com.bitunnel.mobile/tunnel_status")

        methodChannel.setMethodCallHandler { call, result ->
            handleMethodCall(call, result)
        }

        eventChannel.setStreamHandler(object : EventChannel.StreamHandler {
            private var eventSink: EventChannel.EventSink? = null

            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                eventSink = events
                val mainHandler = Handler(Looper.getMainLooper())
                TunnelService.statusCallback = { map ->
                    mainHandler.post { events?.success(map) }
                }
            }

            override fun onCancel(arguments: Any?) {
                eventSink = null
                TunnelService.statusCallback = null
            }
        })
    }

    private fun handleMethodCall(call: MethodCall, result: MethodChannel.Result) {
        Log.i("BiTunnel", "handleMethodCall: ${call.method}")
        try {
            when (call.method) {
                "startClient" -> {
                    val config = call.arguments as? Map<*, *> ?: run {
                        Log.e("BiTunnel", "startClient: invalid args")
                        result.error("INVALID_ARGS", "Missing config", null); return
                    }
                    val json = mapToJson(config)
                    Log.i("BiTunnel", "startClient: ${json.toString()}")
                    val intent = Intent(context, TunnelService::class.java).apply {
                        action = TunnelService.ACTION_START_CLIENT
                        putExtra("config_json", json.toString())
                    }
                    try {
                        context.startForegroundService(intent)
                        Log.i("BiTunnel", "startClient: service started")
                    } catch (e: Exception) {
                        Log.e("BiTunnel", "startClient: failed to start service", e)
                        result.error("SERVICE_ERROR", e.message, null)
                        return
                    }
                    result.success(true)
                }
                "stopClient" -> {
                    val args = call.arguments as? Map<*, *> ?: run {
                        result.error("INVALID_ARGS", "Missing args", null); return
                    }
                    val id = args["id"] as? String ?: run {
                        result.error("INVALID_ARGS", "Missing id", null); return
                    }
                    val intent = Intent(context, TunnelService::class.java).apply {
                        action = TunnelService.ACTION_STOP_CLIENT
                        putExtra("instanceId", id)
                    }
                    context.startService(intent)
                    result.success(true)
                }
                "startServer" -> {
                    val config = call.arguments as? Map<*, *> ?: run {
                        result.error("INVALID_ARGS", "Missing config", null); return
                    }
                    val json = mapToJson(config)
                    val intent = Intent(context, TunnelService::class.java).apply {
                        action = TunnelService.ACTION_START_SERVER
                        putExtra("config_json", json.toString())
                    }
                    context.startForegroundService(intent)
                    result.success(true)
                }
                "stopServer" -> {
                    val args = call.arguments as? Map<*, *> ?: run {
                        result.error("INVALID_ARGS", "Missing args", null); return
                    }
                    val id = args["id"] as? String ?: run {
                        result.error("INVALID_ARGS", "Missing id", null); return
                    }
                    val intent = Intent(context, TunnelService::class.java).apply {
                        action = TunnelService.ACTION_STOP_SERVER
                        putExtra("instanceId", id)
                    }
                    context.startService(intent)
                    result.success(true)
                }
                "startProxy" -> {
                    val config = call.arguments as? Map<*, *> ?: run {
                        result.error("INVALID_ARGS", "Missing config", null); return
                    }
                    val json = mapToJson(config)
                    val intent = Intent(context, TunnelService::class.java).apply {
                        action = TunnelService.ACTION_START_PROXY
                        putExtra("config_json", json.toString())
                    }
                    context.startForegroundService(intent)
                    result.success(true)
                }
                "stopProxy" -> {
                    val args = call.arguments as? Map<*, *> ?: run {
                        result.error("INVALID_ARGS", "Missing args", null); return
                    }
                    val id = args["id"] as? String ?: run {
                        result.error("INVALID_ARGS", "Missing id", null); return
                    }
                    val intent = Intent(context, TunnelService::class.java).apply {
                        action = TunnelService.ACTION_STOP_PROXY
                        putExtra("instanceId", id)
                    }
                    context.startService(intent)
                    result.success(true)
                }
                "getStatus" -> {
                    result.success(TunnelService.currentStatus)
                }
                else -> result.notImplemented()
            }
        } catch (e: Exception) {
            result.error("ERROR", e.message, null)
        }
    }

    private fun mapToJson(map: Map<*, *>): JSONObject {
        val json = JSONObject()
        for ((key, value) in map) {
            val k = key?.toString() ?: continue
            when (value) {
                is String -> json.put(k, value)
                is Number -> json.put(k, value)
                is Boolean -> json.put(k, value)
                is Map<*, *> -> json.put(k, mapToJson(value))
                is List<*> -> json.put(k, listToJson(value))
                null -> json.put(k, JSONObject.NULL)
            }
        }
        return json
    }

    private fun listToJson(list: List<*>): JSONArray {
        val arr = JSONArray()
        for (item in list) {
            when (item) {
                is String -> arr.put(item)
                is Number -> arr.put(item)
                is Boolean -> arr.put(item)
                is Map<*, *> -> arr.put(mapToJson(item))
                is List<*> -> arr.put(listToJson(item))
                null -> arr.put(JSONObject.NULL)
            }
        }
        return arr
    }

    fun dispose() {
        methodChannel.setMethodCallHandler(null)
        eventChannel.setStreamHandler(null)
        TunnelService.statusCallback = null
    }
}
