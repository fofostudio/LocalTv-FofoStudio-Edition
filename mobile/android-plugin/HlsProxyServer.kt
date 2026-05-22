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
        private const val RESOLVE_TTL_MS = 45_000L

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
        var lastErr: Exception? = null
        for (attempt in 0 until 3) {
            try {
                val req = upstreamHeaders(Request.Builder().url(upstream).get()).build()
                http.newCall(req).execute().use { resp ->
                    if (resp.isSuccessful) {
                        val html = resp.body?.string() ?: ""
                        for (pat in M3U8_PATTERNS) {
                            val m = pat.matcher(html)
                            if (m.find()) {
                                val url = m.group(1)?.trim().orEmpty()
                                if (url.startsWith("http")) return url
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                lastErr = e
            }
            try { Thread.sleep(400L * (attempt + 1)) } catch (_: InterruptedException) {}
        }
        throw IOException("Resolve falló para slug=$slug: ${lastErr?.message ?: "sin m3u8"}")
    }

    /** GET con reintentos ante errores transitorios (5xx/timeout/red). 4xx no se reintenta. */
    @Throws(IOException::class)
    private fun getWithRetry(url: String, range: String? = null, tries: Int = 3): okhttp3.Response {
        var lastResp: okhttp3.Response? = null
        var lastErr: Exception? = null
        for (attempt in 0 until tries) {
            try {
                val b = upstreamHeaders(Request.Builder().url(url).get())
                if (range != null) b.header("Range", range)
                val resp = http.newCall(b.build()).execute()
                if (resp.code == 200 || resp.code == 206) return resp
                if (resp.code < 500 && resp.code != 429) return resp  // 4xx definitivo
                lastResp?.close()
                lastResp = resp                                       // 5xx → reintentar
            } catch (e: Exception) {
                lastErr = e
            }
            try { Thread.sleep(300L * (attempt + 1)) } catch (_: InterruptedException) {}
        }
        lastResp?.let { return it }
        throw IOException("Upstream sin respuesta: ${lastErr?.message ?: ""}")
    }

    private fun isMaster(text: String): Boolean = text.contains("#EXT-X-STREAM-INF")

    /** De un master playlist, elige la variante de mayor BANDWIDTH. */
    private fun selectVariant(text: String, base: String): String? {
        val lines = text.lines()
        var bestUrl: String? = null
        var bestBw = -1
        var i = 0
        while (i < lines.size) {
            val l = lines[i].trim()
            if (l.startsWith("#EXT-X-STREAM-INF")) {
                val m = Pattern.compile("""BANDWIDTH=(\d+)""").matcher(l)
                val bw = if (m.find()) (m.group(1)?.toIntOrNull() ?: 0) else 0
                var j = i + 1
                while (j < lines.size) {
                    val u = lines[j].trim()
                    if (u.isNotEmpty() && !u.startsWith("#")) {
                        if (bw > bestBw) { bestBw = bw; bestUrl = resolveUrl(base, u) }
                        break
                    }
                    j++
                }
            }
            i++
        }
        return bestUrl
    }

    private data class Resolved(val ts: Long, val master: String)
    private val resolveCache = java.util.concurrent.ConcurrentHashMap<String, Resolved>()

    /**
     * Devuelve (texto_media_playlist, base). Si el upstream es un master playlist,
     * baja la variante de mayor calidad (aplanado) para que el player refresque
     * /playlist.m3u8 (que re-resuelve) en vez de una URL con token que se vence.
     */
    @Throws(IOException::class)
    private fun resolveMediaPlaylist(slug: String, force: Boolean): Pair<String, String> {
        val now = System.currentTimeMillis()
        val cached = resolveCache[slug]
        val master = if (!force && cached != null && now - cached.ts < RESOLVE_TTL_MS)
            cached.master else resolveStreamUrl(slug)

        getWithRetry(master).use { resp ->
            if (resp.code != 200 && resp.code != 206) throw IOException("Upstream HTTP ${resp.code}")
            val ct = (resp.header("Content-Type") ?: "").lowercase()
            val text = resp.body?.string().orEmpty()
            if (ct.contains("html") || !text.trimStart().startsWith("#EXTM3U"))
                throw IOException("manifest inválido")

            var outText = text
            var base = master
            if (isMaster(text)) {
                val variant = selectVariant(text, master)
                if (variant != null) {
                    getWithRetry(variant).use { rv ->
                        if (rv.code == 200 || rv.code == 206) {
                            val vct = (rv.header("Content-Type") ?: "").lowercase()
                            val vt = rv.body?.string().orEmpty()
                            if (!vct.contains("html") && vt.trimStart().startsWith("#EXTM3U")) {
                                outText = vt; base = variant
                            }
                        }
                    }
                }
            }
            resolveCache[slug] = Resolved(now, master)
            return Pair(outText, base)
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
        // Resolución resiliente: reintentos + aplanado master→variante. Si falla,
        // forzamos re-scrape fresco de tvtvhd y reintentamos una vez (cubre el
        // token/URL vencidos durante la reproducción en vivo).
        val pair = try {
            resolveMediaPlaylist(slug, false)
        } catch (e: Exception) {
            resolveCache.remove(slug)
            try {
                resolveMediaPlaylist(slug, true)
            } catch (e2: Exception) {
                return error502("Canal no disponible: ${e2.message}")
            }
        }
        val rewritten = rewriteManifest(pair.first, base = pair.second, slug = slug)
        return manifest(rewritten)
    }

    private fun handleSegment(slug: String, u: String?, session: IHTTPSession): Response {
        if (u.isNullOrEmpty()) return badRequest("Missing ?u=")
        val target = try { URLDecoder.decode(u, "UTF-8") } catch (_: Exception) { u }
        if (!target.startsWith("http")) return badRequest("Bad URL")

        // GET con reintentos: un blip transitorio del upstream no debe cortar
        // la reproducción en vivo.
        val resp = try {
            getWithRetry(target, session.headers["range"])
        } catch (e: Exception) {
            return error502("Upstream segment error: ${e.message}")
        }
        resp.use { _ ->
            // CRÍTICO: aceptar SOLO 200 OK y 206 Partial Content. tvtvhd
            // a veces responde 404 con Content-Type m3u8 y body "not found"
            // — sin este guard, ese 'not found' llegaba al player y
            // disparaba el demuxer-error.
            if (resp.code != 200 && resp.code != 206) {
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
            if (ct.contains("html")) {
                return error502("Segmento inválido: upstream devolvió HTML")
            }
            val bytes = resp.body?.bytes() ?: ByteArray(0)
            // Sanity: si el body es muy chico, podría ser "not found" / "404"
            // disfrazado con Content-Type binario.
            if (bytes.size < 32) {
                val preview = String(bytes, 0, bytes.size, Charsets.US_ASCII)
                    .trim().lowercase()
                if (preview in listOf("not found", "404", "404 not found",
                                      "forbidden", "unauthorized")) {
                    return error502("Segmento inválido: upstream respondió '$preview'")
                }
            }
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
