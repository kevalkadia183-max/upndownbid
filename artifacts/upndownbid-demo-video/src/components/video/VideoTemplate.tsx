import { useEffect, useRef } from 'react';
import { useVideoPlayer } from '@/lib/video';
import { AnimatePresence, motion } from 'framer-motion';

import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

import textureBg from '@assets/generated_images/texture_bg.png';

export const SCENE_DURATIONS = {
  discover: 4000,
  listing: 4500,
  claim: 4000,
  action: 5000,
  outro: 4000,
};

const SCENE_START_SEC: Record<string, number> = (() => {
  const result: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, duration] of Object.entries(SCENE_DURATIONS)) {
    result[key] = cumulativeMs / 1000;
    cumulativeMs += duration;
  }
  return result;
})();

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({ durations, loop });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = 0.45;
    const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
    if (Math.abs(audio.currentTime - targetTime) > 0.18) {
      audio.currentTime = targetTime;
    }
    audio.play().catch(() => {});
  }, [baseSceneKey, currentSceneKey, muted]);

  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);

  return (
    <>
      <div
        className="w-full h-screen overflow-hidden relative flex"
        style={{ backgroundColor: 'var(--color-bg-light)' }}
      >
      {/* Background layer */}
      <motion.div 
        className="absolute inset-0 opacity-40 mix-blend-multiply"
        style={{
          backgroundImage: `url(${textureBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        animate={{
          scale: [1, 1.05, 1],
          rotate: [0, 2, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
      />
      
      {/* Persistent gradient blobs */}
      <motion.div 
        className="absolute top-0 right-0 w-[50vw] h-[50vw] rounded-full blur-[100px] opacity-30 pointer-events-none"
        style={{ backgroundColor: 'var(--color-primary)' }}
        animate={{
          x: ['0vw', '-20vw', '0vw'],
          y: ['0vh', '10vh', '0vh'],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div 
        className="absolute bottom-0 left-0 w-[40vw] h-[40vw] rounded-full blur-[80px] opacity-20 pointer-events-none"
        style={{ backgroundColor: 'var(--color-secondary)' }}
        animate={{
          x: ['0vw', '20vw', '0vw'],
          y: ['0vh', '-10vh', '0vh'],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />

        {/* mode="popLayout" = new snaps in while old animates out */}
        <AnimatePresence mode="popLayout">
          {sceneIndex === 0 && <Scene1 key={currentSceneKey} />}
          {sceneIndex === 1 && <Scene2 key={currentSceneKey} />}
          {sceneIndex === 2 && <Scene3 key={currentSceneKey} />}
          {sceneIndex === 3 && <Scene4 key={currentSceneKey} />}
          {sceneIndex === 4 && <Scene5 key={currentSceneKey} />}
        </AnimatePresence>
      </div>
      <audio
        ref={audioRef}
        src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        preload="auto"
        autoPlay
        muted={muted}
      />
    </>
  );
}
