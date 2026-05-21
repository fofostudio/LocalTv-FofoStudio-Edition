import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { detectLite, applyLite } from './utils/device'
import './index.css'

// Aplicar modo ligero (TV / equipos lentos) lo antes posible, antes de pintar.
applyLite(detectLite())

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
