package com.fofostudio.localtv.proxy

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.ServerSocket

/**
 * Plugin Capacitor que expone el HlsProxyServer al frontend.
 *
 * Uso desde JS:
 *   import { HlsProxy } from './platform/hlsProxy';
 *   const { baseUrl } = await HlsProxy.start();
 *   // baseUrl = "http://127.0.0.1:43217"
 *   videoEl.src = `${baseUrl}/stream/espn/playlist.m3u8`;
 */
@CapacitorPlugin(name = "HlsProxy")
class HlsProxyPlugin : Plugin() {

    companion object {
        private const val TAG = "HlsProxyPlugin"
    }

    private var server: HlsProxyServer? = null
    private var port: Int = 0

    @PluginMethod
    fun start(call: PluginCall) {
        try {
            if (server == null) {
                port = freePort()
                server = HlsProxyServer(port).apply { start(NanoTimeout, false) }
                Log.i(TAG, "HlsProxyServer started on port $port")
            }
            val ret = JSObject().apply {
                put("baseUrl", "http://127.0.0.1:$port")
                put("port", port)
            }
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "start() failed", e)
            call.reject("Failed to start HLS proxy: ${e.message}", e)
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        try {
            server?.stop()
            server = null
            port = 0
            call.resolve()
        } catch (e: Exception) {
            call.reject("Failed to stop: ${e.message}", e)
        }
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val running = server != null
        val ret = JSObject().apply {
            put("running", running)
            put("port", port)
            put("baseUrl", if (running) "http://127.0.0.1:$port" else "")
        }
        call.resolve(ret)
    }

    /**
     * Devuelve la IP LAN del dispositivo (la que un Chromecast en la
     * misma red puede alcanzar) y la URL base para casting.
     */
    @PluginMethod
    fun networkInfo(call: PluginCall) {
        val ip = lanIp()
        val ret = JSObject().apply {
            put("lanIp", ip)
            put("port", port)
            put("lanUrl", if (port > 0 && ip != null) "http://$ip:$port" else "")
        }
        call.resolve(ret)
    }

    /** Encuentra la IP IPv4 no-loopback de la interfaz Wi-Fi/Ethernet activa. */
    private fun lanIp(): String? {
        return try {
            val ifaces = java.net.NetworkInterface.getNetworkInterfaces()
            while (ifaces.hasMoreElements()) {
                val iface = ifaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is java.net.Inet4Address && !addr.isLoopbackAddress) {
                        return addr.hostAddress
                    }
                }
            }
            null
        } catch (e: Exception) {
            Log.w(TAG, "lanIp failed: ${e.message}")
            null
        }
    }

    override fun handleOnDestroy() {
        try { server?.stop() } catch (_: Exception) {}
        server = null
        super.handleOnDestroy()
    }

    /**
     * Pide al SO un puerto libre y lo cierra inmediatamente.
     * NanoHTTPD lo bindea después; hay una pequeña ventana de race pero en
     * práctica nunca colisiona en un dispositivo personal.
     */
    private fun freePort(): Int {
        ServerSocket(0).use { return it.localPort }
    }

    /** Timeout de socket por request en ms. */
    private val NanoTimeout = 10_000
}
