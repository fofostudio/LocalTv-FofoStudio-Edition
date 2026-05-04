package com.fofostudio.localtv.proxy

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Plugin Capacitor que descarga un APK desde una URL y dispara el intent
 * de instalación nativo de Android. Usado por <UpdateGate /> para
 * actualizar la app sin tener que abrir el navegador.
 *
 * Uso desde JS:
 *   await Capacitor.Plugins.AppUpdater.downloadAndInstall({
 *     url: "https://github.com/.../LocalTv-1.2.3.apk",
 *     filename: "LocalTv-1.2.3.apk"
 *   });
 *
 * Permisos requeridos en AndroidManifest.xml (los inyecta install-plugin.mjs):
 *   <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>
 */
@CapacitorPlugin(name = "AppUpdater")
class AppUpdaterPlugin : Plugin() {

    companion object { private const val TAG = "AppUpdater" }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url")
        val filename = call.getString("filename") ?: "update.apk"

        if (url.isNullOrEmpty()) {
            call.reject("URL vacía")
            return
        }

        val ctx = context.applicationContext
        try {
            val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val req = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle("LocalTv — Actualización")
                setDescription("Descargando $filename")
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalFilesDir(
                    ctx,
                    android.os.Environment.DIRECTORY_DOWNLOADS,
                    filename
                )
                setMimeType("application/vnd.android.package-archive")
            }
            val downloadId = dm.enqueue(req)
            Log.i(TAG, "Download enqueued id=$downloadId url=$url")

            // Listener para cuando termina la descarga -> lanzar install intent
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context, intent: Intent) {
                    val finishedId = intent.getLongExtra(
                        DownloadManager.EXTRA_DOWNLOAD_ID, -1L
                    )
                    if (finishedId != downloadId) return

                    try {
                        ctx.unregisterReceiver(this)
                    } catch (_: Exception) { /* ignore */ }

                    val q = DownloadManager.Query().setFilterById(downloadId)
                    dm.query(q).use { cursor ->
                        if (!cursor.moveToFirst()) {
                            call.reject("Download not found in DM cursor")
                            return
                        }
                        val statusCol = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
                        val status = if (statusCol >= 0) cursor.getInt(statusCol) else -1
                        if (status != DownloadManager.STATUS_SUCCESSFUL) {
                            call.reject("Download falló (status=$status)")
                            return
                        }
                        val uriCol = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)
                        val localUri = if (uriCol >= 0) cursor.getString(uriCol) else null
                        if (localUri == null) {
                            call.reject("Download URI vacía")
                            return
                        }
                        installApk(ctx, Uri.parse(localUri), call)
                    }
                }
            }

            val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ctx.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                ctx.registerReceiver(receiver, filter)
            }

            // Resolvemos la promesa cuando el intent install ya fue lanzado
            // (en installApk). Por ahora no resolvemos aquí.
        } catch (e: Exception) {
            Log.e(TAG, "downloadAndInstall: ${e.message}", e)
            call.reject("downloadAndInstall: ${e.message}", e)
        }
    }

    private fun installApk(ctx: Context, fileUri: Uri, call: PluginCall) {
        try {
            // fileUri viene como file:///path/to/file.apk del DownloadManager.
            // En Android 7+ no podemos pasarlo directo: hay que envolverlo en
            // un FileProvider. Pero como el archivo está en getExternalFilesDir
            // (privado a la app), podemos exponerlo via FileProvider.
            val file = File(fileUri.path ?: throw Exception("fileUri sin path"))
            val authority = "${ctx.packageName}.fileprovider"
            val contentUri = FileProvider.getUriForFile(ctx, authority, file)

            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            ctx.startActivity(intent)

            val ret = JSObject().apply {
                put("ok", true)
                put("installerLaunched", true)
            }
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "installApk: ${e.message}", e)
            call.reject("install: ${e.message}", e)
        }
    }
}
