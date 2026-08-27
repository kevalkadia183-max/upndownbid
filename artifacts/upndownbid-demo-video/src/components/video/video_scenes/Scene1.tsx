import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // Logo appears
      setTimeout(() => setPhase(2), 1000),  // "The transparent leaderboard..." types in
      setTimeout(() => setPhase(3), 2000),  // Subline fades in
      setTimeout(() => setPhase(4), 3200),  // Elements begin exit drift
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const text = "The transparent leaderboard".split(" ");

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10"
      {...sceneTransitions.morphExpand}
    >
      <div className="text-center px-[5vw]">
        <motion.img 
          src={`${import.meta.env.BASE_URL}upndownbid-logo-lockup.png`}
          alt="UpnDownBid" 
          className="h-[6vh] mx-auto mb-[6vh] object-contain"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />

        <h1 className="text-[5vw] font-bold leading-[1.1] tracking-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>
          {text.map((word, i) => (
            <span key={i} className="inline-block overflow-hidden mr-[1.5vw] last:mr-0">
              <motion.span
                className="inline-block"
                initial={{ opacity: 0, y: "100%", rotateX: -30 }}
                animate={phase >= 2 ? { opacity: 1, y: "0%", rotateX: 0 } : { opacity: 0, y: "100%", rotateX: -30 }}
                transition={{ 
                  type: 'spring', 
                  stiffness: 300, 
                  damping: 20, 
                  delay: phase >= 2 ? i * 0.1 : 0 
                }}
              >
                {word}
              </motion.span>
            </span>
          ))}
          <br/>
          <span className="inline-block overflow-hidden">
            <motion.span
              className="inline-block text-[var(--color-primary)]"
              initial={{ opacity: 0, y: "100%", rotateX: -30 }}
              animate={phase >= 2 ? { opacity: 1, y: "0%", rotateX: 0 } : { opacity: 0, y: "100%", rotateX: -30 }}
              transition={{ 
                type: 'spring', 
                stiffness: 300, 
                damping: 20, 
                delay: phase >= 2 ? text.length * 0.1 : 0 
              }}
            >
              for product discovery.
            </motion.span>
          </span>
        </h1>
        
        <motion.div
          className="mt-[4vh]"
          initial={{ opacity: 0, filter: 'blur(10px)' }}
          animate={phase >= 3 ? { opacity: 1, filter: 'blur(0px)' } : { opacity: 0, filter: 'blur(10px)' }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="inline-flex items-center gap-[1vw] bg-white rounded-full px-[1.5vw] py-[1vh] shadow-xl border border-[var(--color-bg-muted)]">
            <div className="w-[1vw] h-[1vw] rounded-full bg-[var(--color-secondary)] animate-pulse" />
            <span className="text-[1.2vw] font-medium text-[var(--color-text-secondary)]">Live Community Rankings</span>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
