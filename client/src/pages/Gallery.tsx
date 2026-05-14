/* 
 * GradeFlow — Gallery Page (Pinterest Masonry)
 * Design: Aero Glass — iOS-inspired glassmorphism
 * - Pinterest-style masonry preserving natural image aspect ratios
 * - Smooth pinch/scroll zoom that changes column count (2 ↔ 3 ↔ 4)
 * - Long-press triggers edit mode with jiggle + delete badges
 * - Drag-to-rearrange in edit mode using @dnd-kit
 * - Download selected images (iOS-friendly)
 * - Floating add button (not in the grid)
 */

import { useState, useRef, useCallback, useEffect, useMemo, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGallery } from "@/contexts/GalleryContext";
import ImageLightbox from "@/components/ImageLightbox";
import { Link } from "wouter";
import { Sparkles, Plus, Check, Trash2, ImagePlus, Zap, Download, Loader2 } from "lucide-react";
import type { GridSize, GalleryImage } from "@/lib/types";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* ─── Sortable Masonry Item ─── */
function SortableMasonryItem({
  image,
  x,
  y,
  w,
  h,
  index,
  borderRadius,
  editMode,
  isSelected,
  isDragOverlay,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onClick,
}: {
  image: GalleryImage;
  x: number;
  y: number;
  w: number;
  h: number;
  index: number;
  borderRadius: string;
  editMode: boolean;
  isSelected: boolean;
  isDragOverlay?: boolean;
  onPointerDown: () => void; // called with image.id already bound
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id, disabled: !editMode });

  // Combine masonry absolute position with dnd-kit transform
  const style: React.CSSProperties = {
    position: "absolute" as const,
    top: 0,
    left: 0,
    width: w,
    height: h,
    // Use CSS transform for both masonry position and drag offset
    transform: `translate3d(${x + (transform?.x ?? 0)}px, ${y + (transform?.y ?? 0)}px, 0)`,
    transition: isDragging ? undefined : "transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)",
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.4 : 1,
    willChange: "transform",
  };

  if (isDragOverlay) {
    return (
      <div
        className={`overflow-hidden ${borderRadius} shadow-2xl`}
        style={{ width: w, height: h }}
      >
        <img
          src={image.url}
          alt={image.name}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="cursor-pointer select-none touch-manipulation"
      {...(editMode ? { ...attributes, ...listeners } : {})}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
      onClick={onClick}
    >
      <div
        className={`relative w-full h-full overflow-hidden transition-all duration-200 ${borderRadius} ${
          editMode && !isDragging ? "animate-jiggle" : ""
        } ${
          isSelected
            ? "ring-3 ring-blue-500 ring-offset-2 scale-[0.96]"
            : "active:scale-[0.98]"
        }`}
        style={{
          animationDelay: editMode ? `${(index % 7) * 0.04}s` : undefined,
        }}
      >
        <img
          src={image.url}
          alt={image.name}
          className="w-full h-full object-cover"
          draggable={false}
          loading="lazy"
        />

        {/* Edit mode overlay */}
        {editMode && (
          <div className="absolute inset-0 bg-black/10 transition-colors">
            <div
              className={`absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                isSelected
                  ? "bg-blue-500 scale-110"
                  : "bg-white/70 backdrop-blur-sm border border-white/50"
              }`}
            >
              {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Download helper (iOS-friendly) ─── */
async function downloadImages(images: GalleryImage[]) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (images.length === 1) {
    // Single image — use share or direct download
    const img = images[0];
    try {
      const response = await fetch(img.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const ext = blob.type.split("/")[1] || "png";
      const filename = `${img.name.replace(/\.[^.]+$/, "")}.${ext}`;

      if (isIOS && navigator.share) {
        const file = new File([blob], filename, { type: blob.type });
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      // Fallback: open in new tab
      window.open(img.url, "_blank");
      toast.info("Image opened in new tab — long-press to save");
    }
    return;
  }

  // Multiple images
  if (isIOS && navigator.share) {
    // iOS: use Web Share API with multiple files
    try {
      const files: File[] = [];
      let failed = 0;
      for (const img of images) {
        try {
          const response = await fetch(img.url);
          if (!response.ok) { failed++; continue; }
          const blob = await response.blob();
          const ext = blob.type.split("/")[1] || "png";
          const filename = `${img.name.replace(/\.[^.]+$/, "")}.${ext}`;
          files.push(new File([blob], filename, { type: blob.type }));
        } catch { failed++; }
      }
      if (files.length > 0) {
        await navigator.share({ files });
        if (failed > 0) toast.info(`${failed} photo${failed > 1 ? "s" : ""} could not be shared`);
      } else {
        toast.error("Could not prepare any photos for sharing");
      }
    } catch {
      toast.info("Share cancelled or not supported");
    }
  } else {
    // Desktop/Android: sequential download
    let downloaded = 0;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      try {
        const response = await fetch(img.url);
        if (!response.ok) { console.warn(`Failed to download ${img.name}: HTTP ${response.status}`); continue; }
        const blob = await response.blob();
        const ext = blob.type.split("/")[1] || "png";
        const filename = `${img.name.replace(/\.[^.]+$/, "")}.${ext}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        downloaded++;
        // Small delay between downloads to avoid browser blocking
        if (i < images.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch {
        console.warn("Failed to download:", img.name);
      }
    }
    const failed = images.length - downloaded;
    if (downloaded > 0) {
      toast.success(`Downloaded ${downloaded} photo${downloaded > 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`);
    } else {
      toast.error("Could not download any photos");
    }
  }
}

/* ─── Gallery Page ─── */
export default function Gallery() {
  const {
    images,
    gridSize,
    setGridSize,
    removeImages,
    addImageFiles,
    reorderImages,
  } = useGallery();

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [imageAspects, setImageAspects] = useState<Map<string, number>>(new Map());
  const [containerWidth, setContainerWidth] = useState(0);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const masonryRef = useRef<HTMLDivElement>(null);
  const lastPinchDistRef = useRef<number | null>(null);
  const pinchAccumRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);

  // DnD sensors — pointer with distance activation, touch with delay
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 10 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 300, tolerance: 8 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  // Measure container width synchronously before paint
  useLayoutEffect(() => {
    const measure = () => {
      if (masonryRef.current) {
        setContainerWidth(masonryRef.current.offsetWidth);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (masonryRef.current) ro.observe(masonryRef.current);
    return () => ro.disconnect();
  }, []);

  // Load natural image dimensions
  useEffect(() => {
    images.forEach((img) => {
      if (!imageAspects.has(img.id)) {
        const el = new Image();
        el.onload = () => {
          setImageAspects((prev) => {
            const next = new Map(prev);
            next.set(img.id, el.naturalWidth / el.naturalHeight);
            return next;
          });
        };
        el.src = img.url;
      }
    });
  }, [images, imageAspects]);

  // Pinch-to-zoom handler (touch)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinchDistRef.current = Math.hypot(dx, dy);
        pinchAccumRef.current = 0;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastPinchDistRef.current !== null) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const delta = dist - lastPinchDistRef.current;
        pinchAccumRef.current += delta;
        lastPinchDistRef.current = dist;

        const threshold = 60;
        if (pinchAccumRef.current > threshold) {
          pinchAccumRef.current = 0;
          setGridSize(Math.max(2, gridSize - 1) as GridSize);
        } else if (pinchAccumRef.current < -threshold) {
          pinchAccumRef.current = 0;
          setGridSize(Math.min(4, gridSize + 1) as GridSize);
        }
      }
    };

    const handleTouchEnd = () => {
      lastPinchDistRef.current = null;
      pinchAccumRef.current = 0;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [gridSize, setGridSize]);

  // Scroll wheel zoom (desktop — ctrl+scroll or trackpad pinch)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let wheelAccum = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        wheelAccum += e.deltaY;

        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelAccum = 0; }, 200);

        const threshold = 50;
        if (wheelAccum > threshold) {
          wheelAccum = 0;
          setGridSize(Math.min(4, gridSize + 1) as GridSize);
        } else if (wheelAccum < -threshold) {
          wheelAccum = 0;
          setGridSize(Math.max(2, gridSize - 1) as GridSize);
        }
      }
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [gridSize, setGridSize]);

  // Compute masonry layout
  const gap = gridSize <= 2 ? 10 : gridSize <= 3 ? 8 : 6;
  const colWidth = containerWidth > 0 ? (containerWidth - gap * (gridSize - 1)) / gridSize : 0;

  const { positioned, totalHeight } = useMemo(() => {
    if (colWidth <= 0) return { positioned: [], totalHeight: 0 };

    const colHeights = new Array(gridSize).fill(0);
    const result: { image: GalleryImage; x: number; y: number; w: number; h: number }[] = [];

    for (const image of images) {
      const minH = Math.min(...colHeights);
      const col = colHeights.indexOf(minH);

      const aspect = imageAspects.get(image.id);
      let height: number;
      if (aspect) {
        height = colWidth / aspect;
        height = Math.max(colWidth * 0.5, Math.min(colWidth * 2.5, height));
      } else {
        const seed = image.id.charCodeAt(0) + image.id.charCodeAt(image.id.length - 1);
        height = colWidth * (0.7 + (seed % 10) * 0.12);
      }

      result.push({
        image,
        x: col * (colWidth + gap),
        y: colHeights[col],
        w: colWidth,
        h: height,
      });

      colHeights[col] += height + gap;
    }

    return { positioned: result, totalHeight: Math.max(...colHeights, 0) };
  }, [images, gridSize, colWidth, gap, imageAspects]);

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
    if (navigator.vibrate) navigator.vibrate(30);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = images.findIndex((img) => img.id === active.id);
      const newIndex = images.findIndex((img) => img.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderImages(oldIndex, newIndex);
        toast.success("Photo moved");
      }
    }
  }, [images, reorderImages]);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  // Long-press handlers for edit mode
  const handlePointerDown = useCallback((imageId: string) => {
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (!editMode) {
        setEditMode(true);
        setSelectedForDelete(new Set([imageId]));
        if (navigator.vibrate) navigator.vibrate(50);
      }
    }, 500);
  }, [editMode]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedForDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);


  const handleDeleteSelected = useCallback(() => {
    if (selectedForDelete.size === 0) return;
    removeImages(Array.from(selectedForDelete));
    toast.success(`Deleted ${selectedForDelete.size} photo${selectedForDelete.size > 1 ? "s" : ""}`);
    setSelectedForDelete(new Set());
  }, [selectedForDelete, removeImages]);

  const handleDownloadSelected = useCallback(async () => {
    const toDownload = selectedForDelete.size > 0
      ? images.filter((img) => selectedForDelete.has(img.id))
      : images;
    if (toDownload.length === 0) return;
    setIsDownloading(true);
    try {
      await downloadImages(toDownload);
    } finally {
      setIsDownloading(false);
    }
  }, [selectedForDelete, images]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setSelectedForDelete(new Set());
  }, []);

  const handleImageClick = useCallback((index: number, imageId: string) => {
    if (longPressTriggeredRef.current) return;
    if (activeDragId) return;
    if (editMode) {
      const newSelected = new Set(selectedForDelete);
      if (newSelected.has(imageId)) {
        newSelected.delete(imageId);
      } else {
        newSelected.add(imageId);
      }
      setSelectedForDelete(newSelected);
      // Auto-exit edit mode when last image is deselected
      if (newSelected.size === 0) {
        setEditMode(false);
      }
    } else {
      setLightboxIndex(index);
    }
  }, [editMode, selectedForDelete, activeDragId]);

  const handleAddPhotos = useCallback(async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      toast.error("Please select image files only");
      return;
    }
    await addImageFiles(imageFiles);
    toast.success(`Added ${imageFiles.length} photo${imageFiles.length > 1 ? "s" : ""}`);
  }, [addImageFiles]);

  // Auto-exit edit mode when all images are deleted
  useEffect(() => {
    if (editMode && images.length === 0) {
      setEditMode(false);
      setSelectedForDelete(new Set());
    }
  }, [images.length, editMode]);

  const borderRadius = gridSize <= 2 ? "rounded-xl" : gridSize <= 3 ? "rounded-lg" : "rounded-md";

  // Find the active drag item for the overlay
  const activeDragItem = activeDragId
    ? positioned.find((p) => p.image.id === activeDragId)
    : null;

  const imageIds = useMemo(() => images.map((img) => img.id), [images]);

  return (
    <div className="container max-w-2xl mx-auto px-4 relative min-h-[calc(100vh-5rem)]" ref={containerRef}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleAddPhotos(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Edit Mode Top Bar */}
      <AnimatePresence>
        {editMode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed top-0 left-0 right-0 z-50 px-4 py-3 glass-strong"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 max-w-[1400px] mx-auto">
              <button
                onClick={exitEditMode}
                className="text-sm font-semibold text-blue-500 active:opacity-70"
              >
                Done
              </button>
              <span className="text-sm font-medium text-slate-600">
                {selectedForDelete.size > 0
                  ? `${selectedForDelete.size} selected`
                  : "Tap to select · Drag to reorder"}
              </span>
              <div className="flex items-center gap-3">
                {/* Download button */}
                <button
                  onClick={handleDownloadSelected}
                  disabled={isDownloading}
                  className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${
                    isDownloading
                      ? "text-slate-300"
                      : "text-blue-500 active:opacity-70"
                  }`}
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {selectedForDelete.size > 0 ? "Save" : "Save All"}
                </button>
                {/* Delete button */}
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedForDelete.size === 0}
                  className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${
                    selectedForDelete.size > 0
                      ? "text-red-500 active:opacity-70"
                      : "text-slate-300"
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gallery Content */}
      <div className={`pb-32 ${editMode ? "pt-14" : ""}`}>
        {/* Gallery Title */}
        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-800 mb-0.5">Gallery</h1>
          <p className="text-slate-600 text-sm">
            {images.length > 0 ? `${images.length} photo${images.length !== 1 ? "s" : ""} in your collection` : "Your photo collection"}
          </p>
        </div>
        {images.length === 0 ? (
          /* Empty State — wrapped in glass card like Convert */
          <div className="glass rounded-2xl p-5 card-shadow">
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mb-5">
                <ImagePlus className="w-9 h-9 text-blue-500" />
              </div>
              <h2 className="text-lg font-semibold text-slate-700 mb-1">No photos yet</h2>
              <p className="text-sm text-slate-400 mb-6 text-center max-w-xs">
                Convert photos with AI or add them directly to start building your gallery.
              </p>
              <div className="flex gap-3">
                <Link href="/convert">
                  <button className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow-lg shadow-blue-500/25 active:scale-95 transition-transform">
                    <Sparkles className="w-4 h-4" />
                    Convert
                  </button>
                </Link>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full glass text-slate-600 text-sm font-semibold card-shadow active:scale-95 transition-transform"
                >
                  <Plus className="w-4 h-4" />
                  Add Photos
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Gallery content wrapped in glass card */}
            <div className="glass rounded-2xl p-4 card-shadow mb-4">
              {/* Subtle column dots */}
              <div className="flex items-center justify-center gap-1.5 mb-3">
                {[2, 3, 4].map((n) => (
                  <button
                    key={n}
                    onClick={() => setGridSize(n as GridSize)}
                    className={`transition-all duration-300 ease-out ${
                      gridSize === n
                        ? "w-6 h-1.5 rounded-full bg-slate-500"
                        : "w-1.5 h-1.5 rounded-full bg-slate-300 hover:bg-slate-400"
                    }`}
                    aria-label={`${n} columns`}
                  />
                ))}
              </div>

              {/* Masonry Grid with DnD */}
              <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext items={imageIds} strategy={rectSortingStrategy}>
                <div
                  ref={masonryRef}
                  className="relative w-full mx-auto"
                  style={{ height: totalHeight > 0 ? totalHeight : "auto", maxWidth: 1400 }}
                >
                  {containerWidth > 0 && positioned.map(({ image, x, y, w, h }, index) => {
                    const isSelected = selectedForDelete.has(image.id);
                    return (
                      <SortableMasonryItem
                        key={image.id}
                        image={image}
                        x={x}
                        y={y}
                        w={w}
                        h={h}
                        index={index}
                        borderRadius={borderRadius}
                        editMode={editMode}
                        isSelected={isSelected}
                        onPointerDown={() => handlePointerDown(image.id)}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerCancel}
                        onClick={() => handleImageClick(index, image.id)}
                      />
                    );
                  })}
                </div>
              </SortableContext>

              {/* Drag Overlay — floating copy of the dragged image */}
              <DragOverlay adjustScale={false}>
                {activeDragItem ? (
                  <SortableMasonryItem
                    image={activeDragItem.image}
                    x={0}
                    y={0}
                    w={activeDragItem.w}
                    h={activeDragItem.h}
                    index={0}
                    borderRadius={borderRadius}
                    editMode={false}
                    isSelected={false}
                    isDragOverlay
                    onPointerDown={() => {}}
                    onPointerUp={() => {}}
                    onPointerCancel={() => {}}
                    onClick={() => {}}
                  />
                ) : null}
              </DragOverlay>
              </DndContext>

              {/* Tip inside the card */}
              {!editMode && (
                <div className="flex items-center gap-2 mt-4 px-1">
                  <Zap className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <p className="text-xs text-slate-500">
                    Tip: Long-press to edit and drag to rearrange. Pinch or Ctrl+scroll to change grid size.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Floating Add Button — only when not in edit mode and has images */}
      <AnimatePresence>
        {!editMode && images.length > 0 && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Add photos to gallery"
            className="fixed bottom-24 right-5 w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-xl shadow-blue-500/30 active:scale-90 transition-transform z-30"
          >
            <Plus className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxIndex !== null && (
          <ImageLightbox
            images={images}
            currentIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
