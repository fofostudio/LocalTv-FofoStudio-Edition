import { useContext } from 'react';
import { ChannelContext } from '../../context/ChannelContext';
import { useVodLibrary } from '../../hooks/useVodLibrary';
import VodPlayer from '../VodPlayer/VodPlayer';

/**
 * Capa VOD global montada a nivel app. Renderiza el reproductor de película/serie
 * desde el contexto, así sobrevive a la navegación ("atrás") y puede minimizarse
 * a PiP sin cortar la reproducción.
 */
export default function VodLayer() {
  const { vod, vodMin, minimizeVod, expandVod, closeVod } = useContext(ChannelContext);
  const lib = useVodLibrary();
  if (!vod) return null;
  return (
    <VodPlayer
      source={vod.source}
      title={vod.title}
      subtitles={vod.subtitles || []}
      startAt={vod.startAt || 0}
      minimized={vodMin}
      onMinimize={minimizeVod}
      onExpand={expandVod}
      onClose={closeVod}
      onProgress={(pos, dur) => { if (vod.mediaType) lib.setProgress(vod.mediaType, vod.id, pos, dur); }}
    />
  );
}
