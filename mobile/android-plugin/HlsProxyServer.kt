package com.fofostudio.localtv.proxy

import android.util.Log
import fi.iki.elonen.NanoHTTPD
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import java.io.IOException
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.regex.Pattern

/**
 * Mini-server HTTP que corre en 127.0.0.1:<puerto random>.
 *
 * Hace lo mismo que backend/app/routers/streams.py pero en Kotlin para que
 * la app Android sea 100% local (sin PC). Solo la WebView de la propia app
 * accede a este server — Android bindea a localhost, no expone puertos.
 *
 * Endpoints:
 *   GET /stream/{slug}/playlist.m3u8     -> manifest reescrito
 *   GET /stream/{slug}/segment?u=<url>   -> proxy de bytes (.ts) o sub-manifest
 *   GET /health                          -> {ok:true} (smoke test del plugin)
 *
 * El bit que justifica todo esto: tvtvhd.com valida el header `Referer` y
 * desde una WebView normal no podés setearlo (es "forbidden header" del
 * fetch spec del browser). OkHttp en Kotlin sí puede.
 */
class HlsProxyServer(port: Int) : NanoHTTPD("0.0.0.0", port) {

    companion object {
        private const val TAG = "HlsProxyServer"
        private const val UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) " +
            "Chrome/120.0.0.0 Mobile Safari/537.36"
        private const val REFERER = "https://tvtvhd.com/"
        private const val ORIGIN = "https://tvtvhd.com"
        private const val UPSTREAM_TEMPLATE =
            "https://tvtvhd.com/vivo/canales.php?stream=%s"

        private val M3U8_PATTERNS = listOf(
            Pattern.compile(
                """playbackURL\s*[=:]\s*["']?([^"'<>\s]+\.m3u8[^"'<>\s]*)""",
                Pattern.CASE_INSENSITIVE
            ),
            Pattern.compile(
                """<source[^>]+src=["']([^"']+\.m3u8[^"']*)""",
                Pattern.CASE_INSENSITIVE
            ),
            Pattern.compile(
                """(https?://[^"'<>\s]+\.m3u8[^"'<>\s]*)""",
                Pattern.CASE_INSENSITIVE
            ),
        )
    }

    private val http: OkHttpClient = OkHttpClient.Builder()
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private fun upstreamHeaders(builder: Request.Builder): Request.Builder = builder
        .header("User-Agent", UA)
        .header("Referer", REFERER)
        .header("Origin", ORIGIN)
        .header("Accept", "*/*")

    // ----------------------------------------------------------------------
    // serve()
    // ----------------------------------------------------------------------
    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        Log.d(TAG, "${session.method} $uri ?${session.queryParameterString ?: ""}")

        return try {
            when {
                uri == "/health" -> json("""{"ok":true}""")
                uri.matches(Regex("""^/stream/[^/]+/playlist\.m3u8$""")) -> {
                    val slug = uri.removePrefix("/stream/").removeSuffix("/playlist.m3u8")
                    handlePlaylist(slug)
                }
                uri.matches(Regex("""^/stream/[^/]+/segment$""")) -> {
                    val slug = uri.removePrefix("/stream/").removeSuffix("/segment")
                    val u = session.parameters["u"]?.firstOrNull()
                    handleSegment(slug, u, session)
                }
                else -> notFound("Unknown route: $uri")
            }
        } catch (e: Exception) {
            Log.e(TAG, "serve() error: ${e.message}", e)
            error502("Internal: ${e.message}")
        }
    }

    // ----------------------------------------------------------------------
    // 1. Resolver slug → URL real del .m3u8 scrapeando el HTML del player
    // ----------------------------------------------------------------------
    @Throws(IOException::class)
    private fun resolveStreamUrl(slug: String): String {
        val upstream = String.format(UPSTREAM_TEMPLATE, slug)
        val req = upstreamHeaders(Request.Builder().url(upstream).get()).build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw IOException("Upstream HTTP ${resp.code}")
            val html = resp.body?.string() ?: throw IOException("Empty upstream body")
            for (pat in M3U8_PATTERNS) {
                val m = pat.matcher(html)
                if (m.find()) {
                    val url = m.group(1)?.trim().orEmpty()
                    if (url.startsWith("http")) return url
                }
            }
            throw IOException("Manifest .m3u8 no encontrado en upstream para slug=$slug")
        }
    }

    // ----------------------------------------------------------------------
    // 2. Reescribir manifest para que segmentos vayan a /stream/{slug}/segment?u=...
    // ----------------------------------------------------------------------
    private fun rewriteManifest(text: String, base: String, slug: String): String {
        val out = StringBuilder()
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty()) {
                out.append('\n'); continue
            }
            if (line.startsWith("#")) {
                if (line.contains("URI=")) {
                    out.append(rewriteUriAttr(line, base, slug))
                } else {
                    out.append(line)
                }
                out.append('\n')
                continue
            }
            // Línea de URL (segmento o sub-playlist)
            val absolute = resolveUrl(base, line)
            out.append("/stream/").append(slug).append("/segment?u=")
                .append(URLEncoder.encode(absolute, "UTF-8"))
                .append('\n')
        }
        return out.toString()
    }

    private fun rewriteUriAttr(line: String, base: String, slug: String): String {
        // URI="..." dentro de #EXT-X-KEY o #EXT-X-MAP
        val pat = Pattern.compile("""URI="([^"]+)"""")
        val m = pat.matcher(line)
        val sb = StringBuffer()
        while (m.find()) {
            val original = m.group(1)!!
            val absolute = resolveUrl(base, original)
            val rewritten = "URI=\"/stream/$slug/segment?u=" +
                URLEncoder.encode(absolute, "UTF-8") + "\""
            m.appendReplacement(sb, java.util.regex.Matcher.quoteReplacement(rewritten))
        }
        m.appendTail(sb)
        return sb.toString()
    }

    private fun resolveUrl(base: String, ref: String): String =
        try { URL(URL(base), ref).toString() } catch (_: Exception) { ref }

    // ----------------------------------------------------------------------
    // 3. Handlers
    // ----------------------------------------------------------------------
    private fun handlePlaylist(slug: String): Response {
        val realUrl = try { resolveStreamUrl(slug) } catch (e: IOException) {
            return error502("Resolve failed: ${e.message}")
        }
        val req = upstreamHeaders(Request.Builder().url(realUrl).get()).build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return error502("Upstream HTTP ${resp.code}")
            val ct = (resp.header("Content-Type") ?: "").lowercase()
            val text = resp.body?.string().orEmpty()

            // Evitar demuxer-error: el upstream a veces entrega HTML en
            // lugar de m3u8 cuando el canal se cayó. Detectamos eso y
            // devolvemos 502 limpio para que hls.js muestre "no disponible"
            // en lugar de explotar parseando.
            if (ct.contains("html")) return error502(
                "Canal no disponible: upstream devolvió HTML"
            )
            val head = text.trimStart().take(32)
            if (!head.startsWith("#EXTM3U")) return error502(
                "Canal no disponible: manifest sin signature #EXTM3U"
            )

            val rewritten = rewriteManifest(text, base = realUrl, slug = slug)
            return manifest(rewritten)
        }
    }

    private fun handleSegment(slug: String, u: String?, session: IHTTPSession): Response {
        if (u.isNullOrEmpty()) return badRequest("Missing ?u=")
        val target = try { URLDecoder.decode(u, "UTF-8") } catch (_: Exception) { u }
        if (!target.startsWith("http")) return badRequest("Bad URL")

        val builder = upstreamHeaders(Request.Builder().url(target).get())
        // Forward Range si el WebView lo manda (seek + buffering)
        session.headers["range"]?.let { builder.header("Range", it) }

        val req = builder.build()
        http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful && resp.code !in 200..299 && resp.code != 206) {
                return error502("Upstream HTTP ${resp.code}")
            }
            val ct = resp.header("Content-Type") ?: "application/octet-stream"

            // Sub-manifest? Reescribir como el playlist principal (con guard).
            val isManifest =
                target.substringBefore('?').endsWith(".m3u8", ignoreCase = true) ||
                ct.contains("mpegurl", ignoreCase = true)
            if (isManifest) {
                val text = resp.body?.string().orEmpty()
                if (ct.contains("html") || !text.trimStart().startsWith("#EXTM3U")) {
                    return error502("Sub-manifest inválido: upstream devolvió HTML/no-HLS")
                }
                val rewritten = rewriteManifest(text, base = target, slug = slug)
                return manifest(rewritten)
            }

            // Binario (segmento .ts/mp4/aac/m4s/CMAF/cifrado/...).
            // Solo descartamos lo OBVIAMENTE roto: Content-Type=html. El
            // resto lo pasamos al player tal cual — la validación agresiva
            // de bytes (sync 0x47, magic ftyp, etc) bloqueaba segmentos
            // válidos pero con formatos inesperados (CMAF, encrypted, m4s)
            // y resultaba en demuxer-error en TODOS los canales.
            if (ct.contains("html")) {
                return error502("Segmento inválido: upstream devolvió HTML")
            }
            val bytes = resp.body?.bytes() ?: ByteArray(0)
            val response = newFixedLengthResponse(
                statusFromCode(resp.code), ct, bytes.inputStream(), bytes.size.toLong()
            )
            resp.header("Content-Range")?.let { response.addHeader("Content-Range", it) }
            resp.header("Accept-Ranges")?.let { response.addHeader("Accept-Ranges", it) }
            response.addHeader("Cache-Control", "public, max-age=10")
            response.addHeader("Access-Control-Allow-Origin", "*")
            return response
        }
    }

    // ----------------------------------------------------------------------
    // Helpers de respuesta
    // ----------------------------------------------------------------------
    private fun manifest(text: String): Response {
        val r = newFixedLengthResponse(
            Response.Status.OK, "application/vnd.apple.mpegurl", text
        )
        r.addHeader("Cache-Control", "no-store")
        r.addHeader("Access-Control-Allow-Origin", "*")
        return r
    }

    private fun json(body: String): Response {
        val r = newFixedLengthResponse(Response.Status.OK, "application/json", body)
        r.addHeader("Access-Control-Allow-Origin", "*")
        return r
    }

    private fun badRequest(msg: String): Response =
        newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain", msg)

    private fun notFound(msg: String): Response =
        newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", msg)

    private fun error502(msg: String): Response =
        newFixedLengthResponse(
            Response.Status.lookup(502) ?: Response.Status.INTERNAL_ERROR,
            "text/plain", msg
        )

    private fun statusFromCode(code: Int): Response.IStatus =
        Response.Status.lookup(code) ?: Response.Status.OK
}
