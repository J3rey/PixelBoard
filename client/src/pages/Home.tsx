/* 
 * GradeFlow — Home (App Dashboard)
 * Design: Aero Glass — iOS-inspired glassmorphism
 * - User-centric dashboard
 * - Quick actions: Convert, Gallery, Add Photos
 * - Add Photos converts files to data URLs for localStorage persistence
 */

import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";
import {
  Upload,
  Images,
  ArrowRight,
  Key,
  CheckCircle2,
  ImagePlus,
  X,
} from "lucide-react";
import { useGallery } from "@/contexts/GalleryContext";
import ApiKeyDialog from "@/components/ApiKeyDialog";
import { trpc } from "@/lib/trpc";
import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

export default function Home() {
  const { apiKey, images, stats, addImageFiles } = useGallery();
  const { data: serverKeyStatus } = trpc.gemini.serverKeyStatus.useQuery();
  const serverKeyConfigured = serverKeyStatus?.configured ?? true;
  const [showApiDialog, setShowApiDialog] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [recentlyAdded, setRecentlyAdded] = useState<{ url: string; name: string }[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { totalSuccess, totalConverted } = stats;

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (imageFiles.length === 0) {
      toast.error("Please select image files only");
      return;
    }

    setIsAdding(true);
    try {
      // Create preview URLs for the confirmation panel
      const previews = imageFiles.map((file) => ({
        url: URL.createObjectURL(file),
        name: file.name,
      }));

      // Add as data URLs for persistence
      await addImageFiles(imageFiles);
      
      setRecentlyAdded(previews);
      toast.success(`Added ${imageFiles.length} photo${imageFiles.length > 1 ? "s" : ""} to gallery`);

      // Clean up blob URLs and clear preview after 4 seconds
      setTimeout(() => {
        previews.forEach(p => URL.revokeObjectURL(p.url));
        setRecentlyAdded([]);
      }, 4000);
    } finally {
      setIsAdding(false);
    }
  }, [addImageFiles]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div className="container max-w-2xl mx-auto px-4">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Greeting */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800 mb-0.5">
          GradeFlow
        </h1>
        <p className="text-slate-600 text-sm">
          Convert and organize your photos with AI.
        </p>
      </div>

      {/* Quick Actions — 3 cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Link href="/convert">
          <div className="glass rounded-2xl p-4 card-shadow hover:card-shadow-hover transition-all cursor-pointer group active:scale-[0.97]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center mb-3 shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/30 transition-shadow">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-xs font-semibold text-slate-700 mb-0.5">Convert</h3>
            <p className="text-xs text-slate-600 leading-tight">AI transform</p>
          </div>
        </Link>

        {/* Add Photos — opens file picker, adds directly to gallery */}
        <div
          className={`glass rounded-2xl p-4 card-shadow hover:card-shadow-hover transition-all cursor-pointer group active:scale-[0.97] ${
            isDragOver ? "ring-2 ring-emerald-400 bg-emerald-50/30" : ""
          } ${isAdding ? "opacity-70 pointer-events-none" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mb-3 shadow-lg shadow-emerald-500/20 group-hover:shadow-emerald-500/30 transition-shadow">
            <ImagePlus className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-xs font-semibold text-slate-700 mb-0.5">Add Photos</h3>
          <p className="text-xs text-slate-600 leading-tight">To gallery</p>
        </div>

        <Link href="/gallery">
          <div className="glass rounded-2xl p-4 card-shadow hover:card-shadow-hover transition-all cursor-pointer group active:scale-[0.97]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center mb-3 shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/30 transition-shadow">
              <Images className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-xs font-semibold text-slate-700 mb-0.5">Gallery</h3>
            <p className="text-xs text-slate-600 leading-tight">
              {images.length > 0 ? `${images.length} photos` : "View photos"}
            </p>
          </div>
        </Link>
      </div>

      {/* Recently Added Confirmation */}
      <AnimatePresence>
        {recentlyAdded.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            className="mb-4 overflow-hidden"
          >
            <div className="glass rounded-2xl p-4 card-shadow border border-emerald-200/50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-semibold text-slate-700">
                    {recentlyAdded.length} photo{recentlyAdded.length > 1 ? "s" : ""} added
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/gallery">
                    <span className="text-xs font-medium text-blue-500 hover:text-blue-600 cursor-pointer">
                      View in Gallery
                    </span>
                  </Link>
                  <button
                    onClick={() => setRecentlyAdded([])}
                    className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100/50 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {recentlyAdded.slice(0, 6).map((img, i) => (
                  <div key={i} className="w-14 h-14 rounded-lg overflow-hidden shrink-0">
                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                  </div>
                ))}
                {recentlyAdded.length > 6 && (
                  <div className="w-14 h-14 rounded-lg bg-slate-100/60 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-slate-400">+{recentlyAdded.length - 6}</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Cards */}
      <div className="space-y-3 mb-6">
        {/* API Status */}
        <div
          className="glass rounded-2xl p-4 card-shadow flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform"
          onClick={() => setShowApiDialog(true)}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                apiKey
                  ? "bg-emerald-50 text-emerald-500"
                  : serverKeyConfigured
                    ? "bg-blue-50 text-blue-400"
                    : "bg-amber-50 text-amber-500"
              }`}
            >
              {apiKey ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <Key className="w-5 h-5" />
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-700">
                {apiKey
                  ? "Override API Key Active"
                  : serverKeyConfigured
                    ? "API Ready"
                    : "API Unavailable"}
              </h4>
              <p className="text-xs text-slate-600">
                {apiKey
                  ? "Tap to manage your override key"
                  : serverKeyConfigured
                    ? "Using server default · Tap to override"
                    : "No server key configured · Tap to add your own"}
              </p>
            </div>
          </div>
          {apiKey ? (
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
          ) : serverKeyConfigured ? (
            <div className="w-2.5 h-2.5 rounded-full bg-blue-300" />
          ) : (
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
          )}
        </div>

        {/* Gallery Stats */}
        <div className="glass rounded-2xl p-4 card-shadow">
          <div className="grid grid-cols-3 divide-x divide-slate-200/50">
            <div className="text-center px-3">
              <div className="text-xl font-bold text-slate-700">{images.length}</div>
              <div className="text-xs text-slate-600 font-medium">In Gallery</div>
            </div>
            <div className="text-center px-3">
              <div className="text-xl font-bold text-slate-700">{totalSuccess}</div>
              <div className="text-xs text-slate-600 font-medium">Converted</div>
            </div>
            <div className="text-center px-3">
              <div className="text-xl font-bold text-slate-700">{totalConverted > 0 ? Math.round((totalSuccess / totalConverted) * 100) : 0}%</div>
              <div className="text-xs text-slate-600 font-medium">Success</div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Gallery Preview */}
      {images.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-600">Recent Photos</h3>
            <Link href="/gallery">
              <span className="text-xs font-medium text-blue-500 hover:text-blue-600 cursor-pointer">
                View all
              </span>
            </Link>
          </div>
          <div className="grid grid-cols-4 gap-1.5 rounded-2xl overflow-hidden">
            {images.slice(-8).reverse().map((img) => (
              <div key={img.id} className="aspect-square overflow-hidden">
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Getting Started */}
      {images.length === 0 && (
        <div className="glass rounded-2xl p-5 card-shadow">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Getting Started</h3>
          <div className="space-y-3">
            {[
              { step: 1, text: "Upload photos to batch convert", done: false },
              { step: 2, text: "View and organize in your gallery", done: false },
            ].map(({ step, text, done }) => (
              <div key={step} className="flex items-center gap-3">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    done
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {done ? <CheckCircle2 className="w-4 h-4" /> : step}
                </div>
                <span
                  className={`text-sm ${
                    done ? "text-slate-400 line-through" : "text-slate-600"
                  }`}
                >
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ApiKeyDialog open={showApiDialog} onOpenChange={setShowApiDialog} />
    </div>
  );
}
