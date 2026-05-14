/* 
 * GradeFlow — Layout (App-Centric)
 * - Bottom tab bar navigation (mobile-first, like iOS)
 * - Minimal top bar with just the title
 * - Clean, immersive content area
 */

import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Upload, Images, Home } from "lucide-react";

const tabs = [
  { path: "/", label: "Home", icon: Home },
  { path: "/convert", label: "Convert", icon: Upload },
  { path: "/gallery", label: "Gallery", icon: Images },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="gradient-bg relative overflow-x-hidden min-h-screen">
      {/* Subtle ambient orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] right-[-5%] w-[400px] h-[400px] rounded-full bg-white/8 blur-3xl" />
        <div className="absolute bottom-[-15%] left-[-10%] w-[500px] h-[500px] rounded-full bg-blue-200/10 blur-3xl" />
      </div>

      {/* Main Content */}
      <main className="relative z-10 pt-4 pb-24 min-h-screen">
        {children}
      </main>

      {/* Bottom Tab Bar */}
      <nav aria-label="Main navigation" className="fixed bottom-0 left-0 right-0 z-50">
        <div className="glass-strong border-t border-white/20">
          <div className="max-w-lg mx-auto flex items-center justify-around px-2 py-2">
            {tabs.map(({ path, label, icon: Icon }) => {
              const isActive = location === path;
              return (
                <Link key={path} href={path}>
                  <motion.div
                    aria-current={isActive ? "page" : undefined}
                    className={`flex flex-col items-center gap-0.5 px-5 py-1.5 rounded-xl transition-colors ${
                      isActive ? "text-blue-600" : "text-slate-400"
                    }`}
                    whileTap={{ scale: 0.92 }}
                  >
                    <div className="relative">
                      <Icon
                        className={`w-5 h-5 transition-all ${
                          isActive ? "text-blue-600" : "text-slate-400"
                        }`}
                        strokeWidth={isActive ? 2.5 : 1.8}
                      />
                      {isActive && (
                        <motion.div
                          layoutId="tab-dot"
                          className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-600"
                          transition={{ type: "spring", stiffness: 500, damping: 35 }}
                        />
                      )}
                    </div>
                    <span
                      className={`text-[10px] font-semibold tracking-wide ${
                        isActive ? "text-blue-600" : "text-slate-400"
                      }`}
                    >
                      {label}
                    </span>
                  </motion.div>
                </Link>
              );
            })}
          </div>
          {/* Safe area for iPhone home indicator */}
          <div className="h-[env(safe-area-inset-bottom,0px)]" />
        </div>
      </nav>
    </div>
  );
}
