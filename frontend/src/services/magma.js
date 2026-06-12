// Firma Magma "horneada" (igual que el token TMDB). El proxy nativo Android la
// necesita para que el panel sirva el stream real en vez del placeholder de
// "actualización obligatoria". En web/desktop el backend ya la aplica (streams.py),
// así que esto sólo se usa en la app Capacitor.
//
// Si el token/firma rotan: corré `python tools/magma_refresh.py`, copiá los
// nuevos valores acá (y a backend/.env) y reconstruí el APK.
export const MAGMA_SIG = {
  xh: 'BDOpQCvSDlbbHGgHGESN4dpDr5eR34_5XLbL-AuuMIopHbTX1pR6OcpbgsfERm2lmbRuoGfHKmVPe0YHHCObB5tdSa2rr3spWobsEBfnTw2QDfNrJmfts8n8wvHF9z24FFgwD7KWyyO7rpxZGSwXcfG8dtgIR294XjgwjXzc30T29QwatFTRHQuucTazn97OUAKi65E2DjLF1UACDzjIOeaei9VkM_IGNiu7x-3L1GrLjbt7HrvhcXJ12BE43wPpoFEfKHfrksAkWRP-0zboNiSBuJ2RjWpKx8KOADbWOMKt8hklYSsRnIPH5gzlzq-BFVoOjpajzUOW73HqkjPEE-muJlvsg8DK4NkN8_aTfMreMYcO7keCzPjjrIEoNzRyNIx68JsKNdjHq8HGEyBhjWxCuR5uzwZJmEhMaIbnnlVO1vb_IuvaiUbJL6uyITp5Uws9IdV8bPmrtBV90DnqyOTf9GvJ9KC3cAypVjy_LTRpMgbdPYtEbo8mV13j5HoXSgWmIJQ5h7o0zYfZeNd6PQ',
  xd: '8556eddcd454679f',
  xv: '10/1.0.9',
};

/** ¿La URL del canal es un stream seguro de Magma? */
export function isMagmaStream(url) {
  return !!url && /\/stream\/secure\/|m3uts|tvcluboficial/.test(url);
}

/**
 * Parámetros que el proxy nativo necesita para un canal Magma, o null si el
 * canal es uno normal (tvtvhd).
 */
export function magmaParamsFor(channel) {
  const url = channel?.stream_url;
  if (!isMagmaStream(url)) return null;
  return { src: url, ...MAGMA_SIG };
}
