import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // Text
      setTimeout(() => setPhase(2), 1200),  // Sponsor tag
      setTimeout(() => setPhase(3), 2500),  // Transform to logo
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10"
      {...sceneTransitions.zoomThrough}
    >
      <AnimatePhase phase={phase} />
    </motion.div>
  );
}

function AnimatePhase({ phase }: { phase: number }) {
  if (phase >= 3) {
    return (
      <motion.div 
        className="w-full h-full flex flex-col items-center justify-center bg-[var(--color-bg-dark)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        <motion.img 
          src={`${import.meta.env.BASE_URL}upndownbid-logo-lockup.png`}
          alt="UpnDownBid" 
          className="h-[8vh] object-contain filter invert brightness-0"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
        />
        <motion.p
          className="text-white/50 text-[1.2vw] mt-[2vh]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          upndownbid.com
        </motion.p>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <motion.h2 
        className="text-[4vw] font-bold tracking-tight text-[var(--color-text-primary)]"
        initial={{ opacity: 0, y: 30 }}
        animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      >
        Sponsor the top spot.
      </motion.h2>

      <motion.div 
        className="mt-[6vh] w-[40vw] bg-white rounded-[1vw] shadow-xl border-2 border-[var(--color-warning)] p-[2vw] relative"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <motion.div 
          className="absolute -top-[2vh] left-1/2 -translate-x-1/2 bg-[var(--color-warning)] text-white font-bold text-[1vw] px-[1.5vw] py-[0.5vh] rounded-full flex items-center gap-[0.5vw]"
          initial={{ opacity: 0, y: 20, scale: 0.5 }}
          animate={phase >= 2 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.5 }}
          transition={{ type: "spring", stiffness: 400, damping: 15 }}
        >
          <svg className="w-[1vw] h-[1vw]" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
          SPONSORED
        </motion.div>
        
        <div className="flex justify-between items-center opacity-30 blur-[2px]">
          <div className="w-[10vw] h-[2vh] bg-gray-300 rounded-full" />
          <div className="w-[4vw] h-[4vw] bg-gray-300 rounded-full" />
        </div>
      </motion.div>
    </div>
  );
}
