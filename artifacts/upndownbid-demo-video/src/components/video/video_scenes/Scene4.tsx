import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { sceneTransitions } from '@/lib/video';
import photo1 from '@assets/generated_images/listing_photo_1.png';
import photo3 from '@assets/generated_images/listing_photo_3.png';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),   // Base layout
      setTimeout(() => setPhase(2), 1500),  // Boost action
      setTimeout(() => setPhase(3), 2800),  // Push down action
      setTimeout(() => setPhase(4), 4400),  // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center z-10"
      {...sceneTransitions.slideLeft}
    >
      <div className="absolute top-[8vh] w-full text-center">
        <motion.h2 
          className="text-[3.5vw] font-bold tracking-tight text-[var(--color-text-primary)]"
          initial={{ opacity: 0, y: -20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
          transition={{ duration: 0.6 }}
        >
          Influence the market.
        </motion.h2>
        <motion.p
          className="text-[1.5vw] text-[var(--color-text-secondary)] mt-[1vh]"
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          Support favorites or penalize the rest.
        </motion.p>
      </div>

      <div className="flex gap-[4vw] mt-[10vh]">
        {/* Boost Card */}
        <motion.div 
          className="w-[25vw] bg-white rounded-[1.5vw] overflow-hidden shadow-xl border border-[var(--color-bg-muted)] relative"
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={
            phase >= 2 
            ? { opacity: 1, y: -20, scale: 1.05, borderColor: "var(--color-primary)", boxShadow: "0 25px 50px -12px rgba(131, 82, 249, 0.25)" }
            : phase >= 1 
            ? { opacity: 1, y: 0, scale: 1 } 
            : { opacity: 0, y: 50, scale: 0.9 }
          }
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          {phase >= 2 && (
            <motion.div 
              className="absolute inset-0 border-4 border-[var(--color-primary)] rounded-[1.5vw] pointer-events-none z-20"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: [0, 1, 0], scale: 1 }}
              transition={{ duration: 1 }}
            />
          )}

          <div className="h-[15vh]">
            <img src={photo1} className="w-full h-full object-cover" />
          </div>
          <div className="p-[1.5vw] text-center">
            <h3 className="text-[1.5vw] font-bold">Artisan Coffee</h3>
            
            <div className="mt-[2vh] flex justify-center items-center gap-[1vw]">
              <span className="text-[1vw] font-bold text-[var(--color-text-secondary)]">POWER</span>
              <motion.span 
                className="text-[2vw] font-mono font-black"
                animate={{ color: phase >= 2 ? "var(--color-primary)" : "var(--color-text-primary)" }}
              >
                {phase >= 2 ? "12,500" : "8,450"}
              </motion.span>
            </div>

            <motion.div 
              className="mt-[2vh] bg-[var(--color-primary)] text-white py-[1vh] rounded-full font-bold text-[1vw] flex items-center justify-center gap-[0.5vw]"
              initial={{ y: 0 }}
              animate={phase >= 2 ? { y: [0, -5, 0] } : { y: 0 }}
              transition={{ type: "spring", stiffness: 400 }}
            >
              <svg className="w-[1.2vw] h-[1.2vw]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
              BOOST
            </motion.div>
          </div>
        </motion.div>

        {/* Penalty Card */}
        <motion.div 
          className="w-[25vw] bg-white rounded-[1.5vw] overflow-hidden shadow-xl border border-[var(--color-bg-muted)] relative"
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={
            phase >= 3 
            ? { opacity: 0.7, y: 20, scale: 0.95, filter: "grayscale(50%)" }
            : phase >= 1 
            ? { opacity: 1, y: 0, scale: 1 } 
            : { opacity: 0, y: 50, scale: 0.9 }
          }
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          {phase >= 3 && (
            <motion.div 
              className="absolute inset-0 border-4 border-[var(--color-destructive)] rounded-[1.5vw] pointer-events-none z-20"
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: [0, 1, 0], scale: 1 }}
              transition={{ duration: 1 }}
            />
          )}

          <div className="h-[15vh]">
            <img src={photo3} className="w-full h-full object-cover" />
          </div>
          <div className="p-[1.5vw] text-center">
            <h3 className="text-[1.5vw] font-bold">Elite Fitness</h3>
            
            <div className="mt-[2vh] flex justify-center items-center gap-[1vw]">
              <span className="text-[1vw] font-bold text-[var(--color-text-secondary)]">POWER</span>
              <motion.span 
                className="text-[2vw] font-mono font-black"
                animate={{ color: phase >= 3 ? "var(--color-destructive)" : "var(--color-text-primary)" }}
              >
                {phase >= 3 ? "3,200" : "5,800"}
              </motion.span>
            </div>

            <motion.div 
              className="mt-[2vh] bg-[var(--color-destructive)] text-white py-[1vh] rounded-full font-bold text-[1vw] flex items-center justify-center gap-[0.5vw]"
              initial={{ y: 0 }}
              animate={phase >= 3 ? { y: [0, 5, 0] } : { y: 0 }}
              transition={{ type: "spring", stiffness: 400 }}
            >
              <svg className="w-[1.2vw] h-[1.2vw]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
              PUSH DOWN
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
