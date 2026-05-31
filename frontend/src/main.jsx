import React from 'react'
import ReactDOM from 'react-dom/client'
import Hls from 'hls.js'
import App from './App'
import { detectLite, applyLite } from './utils/device'
import './index.css'

// hls.js EMPAQUETADO en el bundle (antes venía sólo de un CDN en index.html).
// Crítico para Android: el WebView no soporta HLS nativo, así que si el CDN
// no cargaba (red lenta, portal cautivo, jsdelivr bloqueado, race en arranque)
// no había NINGÚN motor capaz y la reproducción fallaba por completo. Servido
// desde el APK/.exe está siempre disponible, offline del CDN. Lo exponemos en
// window.Hls para que VideoPlayer/VodPlayer lo usen sin cambios.
if (typeof window !== 'undefined') {
  window.Hls = window.Hls || Hls
}

// Aplicar modo ligero (TV / equipos lentos) lo antes posible, antes de pintar.
applyLite(detectLite())

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
