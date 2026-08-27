import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';
import photo1 from '@assets/generated_images/listing_photo_1.png';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // Card flies up
      setTimeout(() => setPhase(2), 1200),  // Image reveals
      setTimeout(() => setPhase(3), 2000),  // Score pops
      setTimeout(() => setPhase(4), 3800),  // Elements begin exit drift
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10"
      {...sceneTransitions.slideUp}
    >
      <div className="absolute top-[10vh] left-[8vw] max-w-[30vw]">
        <motion.h2 
          className="text-[4vw] font-bold leading-[1.1] tracking-tight text-[var(--color-text-primary)]"
          initial={{ opacity: 0, x: -30 }}
          animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          Discover top-ranked businesses.
        </motion.h2>
        <motion.div
          className="w-[5vw] h-[0.5vh] bg-[var(--color-primary)] mt-[2vh]"
          initial={{ scaleX: 0 }}
          animate={phase >= 1 ? { scaleX: 1 } : { scaleX: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          style={{ transformOrigin: "left" }}
        />
      </div>

      <motion.div 
        className="absolute right-[10vw] top-[50vh] -translate-y-1/2 w-[40vw] bg-white rounded-[1.5vw] p-[1.5vw] shadow-2xl border border-[var(--color-bg-muted)]"
        initial={{ opacity: 0, y: 100, rotate: 5, scale: 0.9 }}
        animate={phase >= 1 ? { opacity: 1, y: "-50%", rotate: -2, scale: 1 } : { opacity: 0, y: 100, rotate: 5, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      >
        <div className="flex gap-[1.5vw] items-center">
          <div className="relative w-[10vw] h-[10vw] rounded-[1vw] overflow-hidden bg-gray-100 shrink-0">
            <motion.img 
              src={photo1} 
              className="absolute inset-0 w-full h-full object-cover"
              initial={{ scale: 1.5, filter: "blur(10px)", opacity: 0 }}
              animate={phase >= 2 ? { scale: 1, filter: "blur(0px)", opacity: 1 } : { scale: 1.5, filter: "blur(10px)", opacity: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
          
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <h3 className="text-[1.8vw] font-bold truncate text-[var(--color-text-primary)]">Artisan Coffee Co.</h3>
            <p className="text-[1vw] text-[var(--color-text-secondary)] mt-[0.5vh]">San Francisco, CA</p>
            <div className="flex gap-[0.5vw] mt-[1vh]">
              <span className="px-[0.8vw] py-[0.3vh] bg-[var(--color-bg-light)] text-[0.8vw] rounded-full border">Coffee</span>
              <span className="px-[0.8vw] py-[0.3vh] bg-[var(--color-bg-light)] text-[0.8vw] rounded-full border">Cafe</span>
            </div>
          </div>

          <motion.div 
            className="flex flex-col items-center justify-center bg-[var(--color-bg-light)] rounded-[1vw] p-[1vw] min-w-[8vw]"
            initial={{ scale: 0 }}
            animate={phase >= 3 ? { scale: 1 } : { scale: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            <span className="text-[0.8vw] font-bold text-[var(--color-text-secondary)] uppercase tracking-wider mb-[0.5vh]">Power</span>
            <span className="text-[2.5vw] font-black text-[var(--color-primary)] font-mono leading-none">8,450</span>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}
