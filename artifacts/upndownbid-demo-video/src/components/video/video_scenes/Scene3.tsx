import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';
import photo2 from '@assets/generated_images/listing_photo_2.png';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // Base layout
      setTimeout(() => setPhase(2), 1200),  // Click "Claim"
      setTimeout(() => setPhase(3), 1600),  // Verified badge pops
      setTimeout(() => setPhase(4), 3400),  // Elements begin exit drift
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center z-10"
      {...sceneTransitions.clipPolygon}
    >
      {/* Background shape */}
      <motion.div 
        className="absolute top-0 left-0 bottom-0 w-[45vw] bg-[var(--color-bg-dark)]"
        initial={{ x: "-100%" }}
        animate={phase >= 1 ? { x: "0%" } : { x: "-100%" }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />

      <div className="absolute left-[8vw] max-w-[30vw] z-20">
        <motion.h2 
          className="text-[4vw] font-bold leading-[1.1] tracking-tight text-[var(--color-text-inverse)]"
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.3 }}
        >
          Claim your listing.
        </motion.h2>
        <motion.p 
          className="text-[1.5vw] text-white/70 mt-[2vh]"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.4 }}
        >
          Take control of your brand and engage with your community.
        </motion.p>
      </div>

      <motion.div 
        className="absolute right-[15vw] w-[35vw] bg-white rounded-[1vw] overflow-hidden shadow-2xl border border-[var(--color-bg-muted)]"
        initial={{ opacity: 0, x: 100, rotateY: 20, transformPerspective: 1000 }}
        animate={phase >= 1 ? { opacity: 1, x: 0, rotateY: 0, transformPerspective: 1000 } : { opacity: 0, x: 100, rotateY: 20, transformPerspective: 1000 }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
      >
        <div className="h-[20vh] relative">
          <img src={photo2} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        </div>
        <div className="p-[2vw] relative">
          <h3 className="text-[2vw] font-bold text-[var(--color-text-primary)]">The Artisan Bakery</h3>
          
          <div className="mt-[3vh] flex items-center justify-between">
            <motion.div 
              className="flex items-center gap-[0.5vw]"
              initial={false}
              animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="w-[2vw] h-[2vw] rounded-full bg-[var(--color-success)] flex items-center justify-center">
                <svg className="w-[1vw] h-[1vw] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-[1vw] font-bold text-[var(--color-success)]">Verified Owner</span>
            </motion.div>

            <motion.button 
              className="px-[2vw] py-[1vh] rounded-full font-bold text-[1vw]"
              initial={{ backgroundColor: "var(--color-bg-light)", color: "var(--color-text-primary)", borderColor: "var(--color-bg-muted)" }}
              animate={
                phase >= 2 
                ? { backgroundColor: "var(--color-secondary)", color: "#ffffff", scale: [1, 0.95, 1] } 
                : { backgroundColor: "var(--color-bg-light)", color: "var(--color-text-primary)" }
              }
              transition={{ duration: 0.3 }}
            >
              {phase >= 2 ? "Claimed" : "Claim Listing"}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
