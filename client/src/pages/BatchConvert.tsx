/*
 * GradeFlow — Batch Convert Page
 * Design: Aero Glass — iOS-inspired glassmorphism
 * - Drag & drop upload zone with animated border
 * - Prompt input with style presets
 * - Progress tracking with circular indicators
 * - Results grid with transfer-to-gallery action
 * - All API calls routed through backend tRPC proxy (no CORS issues)
 * - Comprehensive API error handling:
 *   → Rate limit (429) with cooldown + auto-retry
 *   → Quota exhausted banner
 *   → Invalid API key (401/403) detection
 *   → Network error handling with retry
 *   → Batch abort on critical errors
 *   → Smart summary toast
 */

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  X,
  Sparkles,
  Play,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Images,
  Trash2,
  ArrowRight,
  Key,
  RefreshCw,
  ShieldAlert,
  Shield,
  Clock,
  WifiOff,
  Ban,
  RotateCcw,
  Zap,
  Star,
  History,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGallery } from "@/contexts/GalleryContext";
import { trpc } from "@/lib/trpc";
import type { UploadedPhoto, ConvertedPhoto } from "@/lib/types";
import {
  MAX_BATCH_SIZE,
  MAX_IMAGES_PER_DAY,
  MAX_IMAGES_PER_USER_PER_DAY,
  type GeminiUsageSnapshot,
} from "@shared/geminiLimits";
import { nanoid } from "nanoid";
import { toast } from "sonner";
import ApiKeyDialog from "@/components/ApiKeyDialog";
import { Link } from "wouter";

const GRADE_PRESETS = [
  {
    label: "Professionally colour grade",
    prompt:
      "Professionally colour grade this photo with balanced tones, natural colour enhancement, and pleasing contrast. Keep the image realistic and true to life.",
  },
  {
    label: "Cinematic teal & orange",
    prompt:
      "Apply a cinematic teal and orange colour grade. Push shadows towards teal and highlights towards warm orange, like a Hollywood blockbuster film.",
  },
  {
    label: "Golden hour warm",
    prompt:
      "Apply a golden hour colour grade with warm amber and peach tones, gently lifted shadows, and soft glowing highlights.",
  },
  {
    label: "Moody dark",
    prompt:
      "Apply a moody dark colour grade with deep rich shadows, desaturated midtones, and high contrast. Keep detail in the highlights.",
  },
  {
    label: "Faded film",
    prompt:
      "Apply a faded film colour grade with lifted blacks, muted tones, reduced saturation, and an analogue feel reminiscent of expired film.",
  },
  {
    label: "Vibrant pop",
    prompt:
      "Colour grade this photo to be vibrant and punchy with a significant saturation boost, clean bright highlights, and rich deep colours.",
  },
  {
    label: "Cool editorial",
    prompt:
      "Apply a cool editorial colour grade with desaturated tones shifted towards blue, crisp clean shadows, and a high-fashion magazine feel.",
  },
  {
    label: "Soft portrait",
    prompt:
      "Apply a soft portrait colour grade with creamy flattering skintones, gentle low contrast, and warm lifted shadows suited to portraiture.",
  },
];

// Error classification
type ApiErrorType =
  | "rate_limit"
  | "usage_limit"
  | "quota_exhausted"
  | "auth_error"
  | "network_error"
  | "server_error"
  | "unknown";

interface ApiError {
  type: ApiErrorType;
  message: string;
  retryAfter?: number; // seconds
  statusCode?: number;
  usage?: GeminiUsageSnapshot;
  limitType?: string;
}

interface LimitDialogState {
  title: string;
  message: string;
  usage?: GeminiUsageSnapshot;
}

function classifyError(err: any, statusCode?: number): ApiError {
  // Network / fetch errors
  if (err instanceof TypeError && err.message.includes("fetch")) {
    return {
      type: "network_error",
      message: "Network connection failed. Check your internet and try again.",
    };
  }
  if (err.name === "AbortError") {
    return {
      type: "network_error",
      message: "Request timed out. The server took too long to respond.",
    };
  }

  // HTTP status-based classification
  if (statusCode === 429) {
    if (
      err.code === "GRADEFLOW_USAGE_LIMIT" ||
      err.code === "TONELAB_USAGE_LIMIT" ||
      err.code === "PIXELBOARD_USAGE_LIMIT"
    ) {
      return {
        type: "usage_limit",
        message:
          err.message ||
          "GradeFlow safety cap reached. No Gemini request was sent.",
        statusCode,
        usage: err.usage,
        limitType: err.limitType,
      };
    }

    const retryAfter = err.retryAfter || 30;
    return {
      type: "rate_limit",
      message: `API rate limit reached. Please wait ${retryAfter}s before retrying.`,
      retryAfter,
      statusCode,
    };
  }
  if (statusCode === 401 || statusCode === 403) {
    return {
      type: "auth_error",
      message:
        "Invalid or expired API key. Please check your key and try again.",
      statusCode,
    };
  }
  if (statusCode === 402) {
    return {
      type: "quota_exhausted",
      message:
        "API quota exhausted. You've used all available credits. Please upgrade your plan or wait for your quota to reset.",
      statusCode,
    };
  }
  if (statusCode && statusCode >= 500) {
    return {
      type: "server_error",
      message:
        "Gemini API servers are experiencing issues. Please try again later.",
      statusCode,
    };
  }

  // Generic
  return {
    type: "unknown",
    message: err.message || "An unexpected error occurred during conversion.",
    statusCode,
  };
}

function getErrorIcon(type: ApiErrorType) {
  switch (type) {
    case "rate_limit":
      return <Clock className="w-5 h-5" />;
    case "usage_limit":
      return <Ban className="w-5 h-5" />;
    case "quota_exhausted":
      return <Ban className="w-5 h-5" />;
    case "auth_error":
      return <ShieldAlert className="w-5 h-5" />;
    case "network_error":
      return <WifiOff className="w-5 h-5" />;
    case "server_error":
      return <Zap className="w-5 h-5" />;
    default:
      return <AlertCircle className="w-5 h-5" />;
  }
}

function getErrorColor(type: ApiErrorType) {
  switch (type) {
    case "rate_limit":
      return {
        bg: "bg-amber-50/80",
        border: "border-amber-200/60",
        icon: "text-amber-500",
        text: "text-amber-700",
      };
    case "usage_limit":
      return {
        bg: "bg-blue-50/80",
        border: "border-blue-200/60",
        icon: "text-blue-500",
        text: "text-blue-700",
      };
    case "quota_exhausted":
      return {
        bg: "bg-red-50/80",
        border: "border-red-200/60",
        icon: "text-red-500",
        text: "text-red-700",
      };
    case "auth_error":
      return {
        bg: "bg-orange-50/80",
        border: "border-orange-200/60",
        icon: "text-orange-500",
        text: "text-orange-700",
      };
    case "network_error":
      return {
        bg: "bg-slate-50/80",
        border: "border-slate-200/60",
        icon: "text-slate-500",
        text: "text-slate-700",
      };
    case "server_error":
      return {
        bg: "bg-purple-50/80",
        border: "border-purple-200/60",
        icon: "text-purple-500",
        text: "text-purple-700",
      };
    default:
      return {
        bg: "bg-red-50/80",
        border: "border-red-200/60",
        icon: "text-red-500",
        text: "text-red-700",
      };
  }
}

export default function BatchConvert() {
  const {
    apiKey,
    convertedPhotos,
    setConvertedPhotos,
    transferAllToGallery,
    promptHistory,
    addPromptToHistory,
    togglePromptFavorite,
    removePromptFromHistory,
    recordConversion,
  } = useGallery();
  const [showPromptHistory, setShowPromptHistory] = useState(false);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [prompt, setPrompt] = useState(GRADE_PRESETS[0].prompt);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showApiDialog, setShowApiDialog] = useState(false);
  const [limitDialog, setLimitDialog] = useState<LimitDialogState | null>(null);

  // Error state
  const [batchError, setBatchError] = useState<ApiError | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // tRPC mutation for generating images via Gemini backend proxy
  const generateMutation = trpc.gemini.generate.useMutation();
  const usageQuery = trpc.gemini.usageStatus.useQuery(undefined, {
    staleTime: 10_000,
  });

  const openLimitDialog = useCallback(
    (title: string, message: string, usage?: GeminiUsageSnapshot) => {
      setLimitDialog({ title, message, usage });
      toast.warning(title, { description: message });
    },
    []
  );

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter(f =>
        f.type.startsWith("image/")
      );
      if (imageFiles.length === 0) {
        toast.error("Please select image files only");
        return;
      }

      const remainingSlots = Math.max(0, MAX_BATCH_SIZE - photos.length);
      if (remainingSlots === 0) {
        openLimitDialog(
          "Batch limit reached",
          `You can convert up to ${MAX_BATCH_SIZE} images in one batch. Clear or remove one first.`
        );
        return;
      }

      const acceptedFiles = imageFiles.slice(0, remainingSlots);
      const skippedCount = imageFiles.length - acceptedFiles.length;

      const newPhotos: UploadedPhoto[] = acceptedFiles.map(file => ({
        id: nanoid(),
        file,
        preview: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
      }));

      setPhotos(prev => [...prev, ...newPhotos]);
      toast.success(
        `Added ${acceptedFiles.length} photo${acceptedFiles.length > 1 ? "s" : ""}`
      );

      if (skippedCount > 0) {
        openLimitDialog(
          "Only 3 images per batch",
          `${skippedCount} image${skippedCount === 1 ? "" : "s"} were skipped so this batch stays inside the safety cap.`
        );
      }
    },
    [openLimitDialog, photos.length]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const removePhoto = (id: string) => {
    setPhotos(prev => {
      const photo = prev.find(p => p.id === id);
      if (photo) URL.revokeObjectURL(photo.preview);
      return prev.filter(p => p.id !== id);
    });
  };

  const clearAll = () => {
    photos.forEach(p => URL.revokeObjectURL(p.preview));
    setPhotos([]);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Start a cooldown timer
  const startCooldown = (seconds: number) => {
    setCooldownSeconds(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownSeconds(prev => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Sleep helper for retry delays
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Convert a single photo via the backend tRPC proxy.
   * Returns { ok, status, data } so the caller can classify errors.
   */
  const convertSinglePhoto = async (
    photo: UploadedPhoto,
    currentPrompt: string,
    batchSize: number
  ) => {
    const base64 = await fileToBase64(photo.file);

    const result = await generateMutation.mutateAsync({
      apiKey: apiKey || undefined,
      prompt: currentPrompt,
      imageBase64: base64,
      imageMimeType: photo.file.type,
      batchSize,
    });

    return result; // { status, data, ok }
  };

  const convertPhotos = async () => {
    if (photos.length === 0) {
      toast.error("Please upload some photos first");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Please enter a conversion prompt");
      return;
    }
    if (photos.length > MAX_BATCH_SIZE) {
      openLimitDialog(
        "Batch limit reached",
        `This batch has ${photos.length} images. Keep it to ${MAX_BATCH_SIZE} or fewer so the Gemini safety cap holds.`
      );
      return;
    }
    if (usageQuery.data && photos.length > usageQuery.data.userRemaining) {
      openLimitDialog(
        "Daily user cap reached",
        `This browser has ${usageQuery.data.userRemaining} Gemini image conversion${usageQuery.data.userRemaining === 1 ? "" : "s"} left today. The per-user cap is ${MAX_IMAGES_PER_USER_PER_DAY}.`,
        usageQuery.data
      );
      return;
    }
    if (usageQuery.data && photos.length > usageQuery.data.globalRemaining) {
      openLimitDialog(
        "Daily project cap reached",
        `GradeFlow has ${usageQuery.data.globalRemaining} Gemini image conversion${usageQuery.data.globalRemaining === 1 ? "" : "s"} left today. The project cap is ${MAX_IMAGES_PER_DAY}.`,
        usageQuery.data
      );
      return;
    }
    if (cooldownSeconds > 0) {
      toast.error(
        `Please wait ${cooldownSeconds}s before retrying (rate limit cooldown)`
      );
      return;
    }

    // Save prompt to history
    addPromptToHistory(prompt);

    setIsConverting(true);
    setProgress(0);
    setBatchError(null);
    abortRef.current = false;

    const results: ConvertedPhoto[] = photos.map(p => ({
      id: p.id,
      originalPreview: p.preview,
      convertedUrl: "",
      originalName: p.name,
      prompt: prompt,
      status: "pending" as const,
    }));

    setConvertedPhotos(results);

    let successCount = 0;
    let failCount = 0;
    let rateLimitHit = false;

    for (let i = 0; i < photos.length; i++) {
      // Check if batch was aborted
      if (abortRef.current) {
        setConvertedPhotos(prev =>
          prev.map(r =>
            r.status === "pending"
              ? {
                  ...r,
                  status: "error" as const,
                  error: "Batch stopped due to critical error",
                }
              : r
          )
        );
        break;
      }

      const photo = photos[i];

      // Update status to converting
      setConvertedPhotos(prev =>
        prev.map(r =>
          r.id === photo.id ? { ...r, status: "converting" as const } : r
        )
      );

      let retries = 0;
      const maxRetries = 2;
      let converted = false;

      while (retries <= maxRetries && !converted && !abortRef.current) {
        try {
          const result = await convertSinglePhoto(photo, prompt, photos.length);

          if (!result.ok) {
            // Non-OK response from Gemini API (proxied through backend)
            const apiError = classifyError(
              {
                code: result.data?.code,
                limitType: result.data?.limitType,
                message:
                  result.data?.message ||
                  result.data?.error ||
                  `HTTP ${result.status}`,
                retryAfter: 30,
                usage: result.data?.usage,
              },
              result.status
            );

            // Critical errors — abort the entire batch
            if (apiError.type === "auth_error") {
              setBatchError(apiError);
              abortRef.current = true;
              setConvertedPhotos(prev =>
                prev.map(r =>
                  r.id === photo.id
                    ? {
                        ...r,
                        status: "error" as const,
                        error: apiError.message,
                      }
                    : r.status === "pending"
                      ? {
                          ...r,
                          status: "error" as const,
                          error: "Stopped: Invalid API key",
                        }
                      : r
                )
              );
              failCount++;
              converted = true;
              break;
            }

            if (apiError.type === "quota_exhausted") {
              setBatchError(apiError);
              abortRef.current = true;
              setConvertedPhotos(prev =>
                prev.map(r =>
                  r.id === photo.id
                    ? {
                        ...r,
                        status: "error" as const,
                        error: apiError.message,
                      }
                    : r.status === "pending"
                      ? {
                          ...r,
                          status: "error" as const,
                          error: "Stopped: API quota exhausted",
                        }
                      : r
                )
              );
              failCount++;
              converted = true;
              break;
            }

            if (apiError.type === "usage_limit") {
              setBatchError(apiError);
              openLimitDialog(
                "Gemini safety cap reached",
                apiError.message,
                apiError.usage
              );
              abortRef.current = true;
              setConvertedPhotos(prev =>
                prev.map(r =>
                  r.id === photo.id
                    ? {
                        ...r,
                        status: "error" as const,
                        error: apiError.message,
                      }
                    : r.status === "pending"
                      ? {
                          ...r,
                          status: "error" as const,
                          error: "Stopped: safety cap reached",
                        }
                      : r
                )
              );
              failCount++;
              converted = true;
              break;
            }

            // Rate limit — wait and retry
            if (apiError.type === "rate_limit") {
              rateLimitHit = true;
              const waitTime = apiError.retryAfter || 30;

              if (retries < maxRetries) {
                toast.warning(
                  `Rate limited. Waiting ${waitTime}s before retry... (attempt ${retries + 1}/${maxRetries})`
                );
                startCooldown(waitTime);
                await sleep(waitTime * 1000);
                retries++;
                continue;
              } else {
                setBatchError({
                  ...apiError,
                  message: `Rate limit hit for one photo after ${maxRetries} retries — skipping it and continuing.`,
                });
                setConvertedPhotos(prev =>
                  prev.map(r =>
                    r.id === photo.id
                      ? {
                          ...r,
                          status: "error" as const,
                          error: "Rate limit — max retries reached",
                        }
                      : r
                  )
                );
                failCount++;
                converted = true;
                break;
              }
            }

            // Server errors — retry once
            if (apiError.type === "server_error" && retries < maxRetries) {
              toast.warning(
                `Server error (${result.status}). Retrying in 5s...`
              );
              await sleep(5000);
              retries++;
              continue;
            }

            // All other errors — fail this photo, continue batch
            throw new Error(apiError.message);
          }

          // Success — extract image URL from response
          const data = result.data;
          const imageUrl =
            data?.images?.[0]?.url || data?.result?.url || data?.url;
          if (!imageUrl) {
            throw new Error("No image URL found in successful response");
          }

          setConvertedPhotos(prev =>
            prev.map(r =>
              r.id === photo.id
                ? { ...r, status: "done" as const, convertedUrl: imageUrl }
                : r
            )
          );
          successCount++;
          converted = true;
        } catch (err: any) {
          if (abortRef.current) break;

          const apiError = classifyError(err);

          // Network errors — retry
          if (apiError.type === "network_error" && retries < maxRetries) {
            toast.warning(
              `Network error. Retrying in 3s... (attempt ${retries + 1}/${maxRetries})`
            );
            await sleep(3000);
            retries++;
            continue;
          }

          // Final failure for this photo
          console.error("Conversion error:", err);
          setConvertedPhotos(prev =>
            prev.map(r =>
              r.id === photo.id
                ? {
                    ...r,
                    status: "error" as const,
                    error: apiError.message,
                  }
                : r
            )
          );
          failCount++;
          converted = true;

          if (apiError.type === "network_error") {
            setBatchError(apiError);
          }
        }
      }

      setProgress(((i + 1) / photos.length) * 100);

      // Small delay between requests to avoid hitting rate limits
      if (i < photos.length - 1 && !abortRef.current) {
        await sleep(1000);
      }
    }

    setIsConverting(false);
    recordConversion(successCount, failCount);
    usageQuery.refetch();

    // Smart summary toast
    if (abortRef.current && failCount > 0) {
      // Don't show success toast if batch was aborted
    } else if (failCount === 0) {
      toast.success(`All ${successCount} photos converted successfully!`);
    } else if (successCount === 0) {
      toast.error(`All ${failCount} conversions failed.`);
    } else {
      toast.warning(`${successCount} converted, ${failCount} failed.`);
    }

    if (rateLimitHit && !abortRef.current) {
      startCooldown(15);
    }
  };

  // Retry only failed photos
  const retryFailed = async () => {
    if (cooldownSeconds > 0) {
      toast.error(`Please wait ${cooldownSeconds}s before retrying`);
      return;
    }

    const failedPhotos = convertedPhotos.filter(p => p.status === "error");
    if (failedPhotos.length === 0) return;
    if (failedPhotos.length > MAX_BATCH_SIZE) {
      openLimitDialog(
        "Retry batch is too large",
        `There are ${failedPhotos.length} failed images. Keep retries to ${MAX_BATCH_SIZE} at a time to stay inside the Gemini safety cap.`
      );
      return;
    }
    if (
      usageQuery.data &&
      failedPhotos.length > usageQuery.data.userRemaining
    ) {
      openLimitDialog(
        "Daily user cap reached",
        `This browser has ${usageQuery.data.userRemaining} Gemini image conversion${usageQuery.data.userRemaining === 1 ? "" : "s"} left today.`,
        usageQuery.data
      );
      return;
    }
    if (
      usageQuery.data &&
      failedPhotos.length > usageQuery.data.globalRemaining
    ) {
      openLimitDialog(
        "Daily project cap reached",
        `GradeFlow has ${usageQuery.data.globalRemaining} Gemini image conversion${usageQuery.data.globalRemaining === 1 ? "" : "s"} left today.`,
        usageQuery.data
      );
      return;
    }

    setBatchError(null);
    setIsConverting(true);
    abortRef.current = false;

    // Reset failed items to pending
    setConvertedPhotos(prev =>
      prev.map(r =>
        r.status === "error"
          ? { ...r, status: "pending" as const, error: undefined }
          : r
      )
    );

    let retrySuccess = 0;
    let retryFail = 0;

    for (let i = 0; i < failedPhotos.length; i++) {
      if (abortRef.current) break;

      const failedPhoto = failedPhotos[i];
      const originalPhoto = photos.find(p => p.id === failedPhoto.id);
      if (!originalPhoto) {
        retryFail++;
        continue;
      }

      setConvertedPhotos(prev =>
        prev.map(r =>
          r.id === failedPhoto.id ? { ...r, status: "converting" as const } : r
        )
      );

      try {
        const result = await convertSinglePhoto(
          originalPhoto,
          prompt || failedPhoto.prompt,
          failedPhotos.length
        );

        if (!result.ok) {
          const apiError = classifyError(
            {
              code: result.data?.code,
              limitType: result.data?.limitType,
              message:
                result.data?.message ||
                result.data?.error ||
                `HTTP ${result.status}`,
              usage: result.data?.usage,
            },
            result.status
          );

          if (
            apiError.type === "auth_error" ||
            apiError.type === "quota_exhausted" ||
            apiError.type === "rate_limit" ||
            apiError.type === "usage_limit"
          ) {
            setBatchError(apiError);
            abortRef.current = true;
            if (apiError.type === "rate_limit") {
              startCooldown(apiError.retryAfter || 30);
            }
            if (apiError.type === "usage_limit") {
              openLimitDialog(
                "Gemini safety cap reached",
                apiError.message,
                apiError.usage
              );
            }
          }

          throw new Error(apiError.message);
        }

        const data = result.data;
        const imageUrl =
          data?.images?.[0]?.url || data?.result?.url || data?.url;
        if (!imageUrl) {
          throw new Error("No image URL found in successful response");
        }

        setConvertedPhotos(prev =>
          prev.map(r =>
            r.id === failedPhoto.id
              ? {
                  ...r,
                  status: "done" as const,
                  convertedUrl: imageUrl,
                  error: undefined,
                }
              : r
          )
        );
        retrySuccess++;
      } catch (err: any) {
        setConvertedPhotos(prev =>
          prev.map(r =>
            r.id === failedPhoto.id
              ? {
                  ...r,
                  status: "error" as const,
                  error: err.message || "Retry failed",
                }
              : r
          )
        );
        retryFail++;
      }

      setProgress(((i + 1) / failedPhotos.length) * 100);
    }

    setIsConverting(false);
    recordConversion(retrySuccess, retryFail);
    usageQuery.refetch();

    if (retrySuccess > 0 && retryFail === 0) {
      toast.success(`All ${retrySuccess} retries succeeded!`);
    } else if (retrySuccess > 0) {
      toast.warning(`${retrySuccess} recovered, ${retryFail} still failed.`);
    } else {
      toast.error(`All ${retryFail} retries failed.`);
    }
  };

  const dismissError = () => setBatchError(null);

  const doneCount = convertedPhotos.filter(p => p.status === "done").length;
  const errorCount = convertedPhotos.filter(p => p.status === "error").length;

  const handleDownloadAll = useCallback(async () => {
    const donePhotos = convertedPhotos.filter(p => p.status === "done");
    if (donePhotos.length === 0) return;
    setIsDownloadingAll(true);
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    try {
      if (isIOS && navigator.share) {
        const files: File[] = [];
        for (const photo of donePhotos) {
          try {
            const response = await fetch(photo.convertedUrl);
            const blob = await response.blob();
            const ext = blob.type.split("/")[1] || "png";
            files.push(
              new File(
                [blob],
                `${photo.originalName.replace(/\.[^.]+$/, "")}_converted.${ext}`,
                { type: blob.type }
              )
            );
          } catch {
            /* skip */
          }
        }
        if (files.length > 0) await navigator.share({ files });
      } else {
        for (let i = 0; i < donePhotos.length; i++) {
          const photo = donePhotos[i];
          try {
            const response = await fetch(photo.convertedUrl);
            const blob = await response.blob();
            const ext = blob.type.split("/")[1] || "png";
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${photo.originalName.replace(/\.[^.]+$/, "")}_converted.${ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (i < donePhotos.length - 1)
              await new Promise(r => setTimeout(r, 300));
          } catch {
            /* skip */
          }
        }
        toast.success(
          `Downloaded ${donePhotos.length} converted photo${donePhotos.length > 1 ? "s" : ""}`
        );
      }
    } catch {
      toast.error("Download failed");
    } finally {
      setIsDownloadingAll(false);
    }
  }, [convertedPhotos]);

  return (
    <div className="container max-w-2xl mx-auto px-4 pb-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800 mb-0.5">Convert</h1>
        <p className="text-slate-600 text-sm">
          Upload photos and transform them with AI.
        </p>
      </div>

      <div className="glass rounded-2xl p-4 card-shadow mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <Shield className="w-4 h-4 text-blue-500" />
              Gemini safety caps
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {MAX_BATCH_SIZE} per batch, {MAX_IMAGES_PER_USER_PER_DAY} per user
              per day, {MAX_IMAGES_PER_DAY} per project per day
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-lg bg-white/55 text-slate-600 font-semibold">
              User{" "}
              {usageQuery.data
                ? usageQuery.data.userRemaining
                : MAX_IMAGES_PER_USER_PER_DAY}{" "}
              left
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-white/55 text-slate-600 font-semibold">
              Project{" "}
              {usageQuery.data
                ? usageQuery.data.globalRemaining
                : MAX_IMAGES_PER_DAY}{" "}
              left
            </span>
          </div>
        </div>
      </div>

      {/* === Batch Error Banner === */}
      <AnimatePresence>
        {batchError && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            className="mb-4 overflow-hidden"
          >
            <div
              className={`rounded-2xl p-4 border ${getErrorColor(batchError.type).bg} ${getErrorColor(batchError.type).border}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 ${getErrorColor(batchError.type).icon}`}
                >
                  {getErrorIcon(batchError.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <h4
                    className={`text-sm font-bold ${getErrorColor(batchError.type).text} mb-0.5`}
                  >
                    {batchError.type === "rate_limit" && "Rate Limit Reached"}
                    {batchError.type === "usage_limit" && "Safety Cap Reached"}
                    {batchError.type === "quota_exhausted" &&
                      "API Quota Exhausted"}
                    {batchError.type === "auth_error" &&
                      "Authentication Failed"}
                    {batchError.type === "network_error" && "Connection Error"}
                    {batchError.type === "server_error" && "Server Error"}
                    {batchError.type === "unknown" && "Conversion Error"}
                  </h4>
                  <p
                    className={`text-xs ${getErrorColor(batchError.type).text} opacity-80 leading-relaxed`}
                  >
                    {batchError.message}
                  </p>

                  {/* Cooldown timer */}
                  {cooldownSeconds > 0 && (
                    <div className="flex items-center gap-2 mt-2">
                      <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                      <span className="text-xs font-mono font-bold text-amber-600">
                        Retry available in {cooldownSeconds}s
                      </span>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 mt-3">
                    {batchError.type === "auth_error" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setShowApiDialog(true);
                          dismissError();
                        }}
                        className="bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-lg h-8 px-3 text-xs font-semibold"
                      >
                        <Key className="w-3 h-3 mr-1.5" />
                        Update API Key
                      </Button>
                    )}
                    {batchError.type === "quota_exhausted" && (
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          size="sm"
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg h-8 px-3 text-xs font-semibold"
                        >
                          <Zap className="w-3 h-3 mr-1.5" />
                          Upgrade Plan
                        </Button>
                      </a>
                    )}
                    {(batchError.type === "rate_limit" ||
                      batchError.type === "network_error" ||
                      batchError.type === "server_error") &&
                      errorCount > 0 && (
                        <Button
                          size="sm"
                          onClick={retryFailed}
                          disabled={isConverting || cooldownSeconds > 0}
                          className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg h-8 px-3 text-xs font-semibold disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3 mr-1.5" />
                          Retry Failed ({errorCount})
                        </Button>
                      )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={dismissError}
                      className="rounded-lg h-8 px-3 text-xs text-slate-500 hover:text-slate-700"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
                <button
                  onClick={dismissError}
                  aria-label="Dismiss error"
                  className="p-1 -m-1 text-slate-400 hover:text-slate-600 transition-colors rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload Zone */}
      <motion.div
        className={`glass rounded-2xl p-5 card-shadow mb-4 transition-all ${
          isDragOver ? "ring-2 ring-blue-400 bg-blue-50/30" : ""
        }`}
        onDragOver={e => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />

        {photos.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-12 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <motion.div
              className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mb-5"
              animate={{ y: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 2.5 }}
            >
              <Upload className="w-9 h-9 text-blue-500" />
            </motion.div>
            <h3 className="text-lg font-bold text-slate-700 mb-1">
              Drop photos here or click to browse
            </h3>
            <p className="text-sm text-slate-400">
              Supports JPG, PNG, WebP - up to 3 photos per batch
            </p>
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <h3 className="text-base font-bold text-slate-700 whitespace-nowrap">
                  {photos.length} photo{photos.length > 1 ? "s" : ""} selected
                </h3>
                <span className="text-xs font-mono text-slate-400 whitespace-nowrap">
                  {(
                    photos.reduce((sum, p) => sum + p.size, 0) /
                    1024 /
                    1024
                  ).toFixed(1)}{" "}
                  MB
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="glass rounded-lg text-slate-500 hover:text-blue-600 hover:bg-white/60"
                  onClick={() => {
                    if (photos.length >= MAX_BATCH_SIZE) {
                      openLimitDialog(
                        "Batch limit reached",
                        `You can convert up to ${MAX_BATCH_SIZE} images in one batch. Remove one before adding more.`
                      );
                      return;
                    }
                    fileInputRef.current?.click();
                  }}
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Add More
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="glass rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50/50"
                  onClick={clearAll}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Clear
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              <AnimatePresence>
                {photos.map(photo => (
                  <motion.div
                    key={photo.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="relative group aspect-square rounded-xl overflow-hidden"
                  >
                    <img
                      src={photo.preview}
                      alt={photo.name}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                    <button
                      onClick={() => removePhoto(photo.id)}
                      aria-label={`Remove ${photo.name}`}
                      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <div className="absolute bottom-0 left-0 right-0 p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-xs text-white truncate font-medium bg-black/40 rounded px-1.5 py-0.5">
                        {photo.name}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </motion.div>

      {/* Prompt & Convert */}
      <div className="glass rounded-2xl p-5 card-shadow mb-4">
        <h3 className="text-base font-bold text-slate-700 mb-3">
          Conversion Prompt
        </h3>
        <div className="flex gap-3 mb-4">
          <Input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe how you want to transform your photos..."
            aria-label="Conversion prompt"
            className="h-12 rounded-xl bg-white/50 border-white/40 focus:border-blue-400 text-base"
            disabled={isConverting}
          />
          <Button
            onClick={convertPhotos}
            disabled={
              isConverting || photos.length === 0 || cooldownSeconds > 0
            }
            className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl h-11 px-5 font-semibold shadow-lg shadow-blue-500/25 shrink-0 disabled:opacity-50"
          >
            {isConverting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : cooldownSeconds > 0 ? (
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                {cooldownSeconds}s
              </span>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Convert
              </>
            )}
          </Button>
        </div>

        {/* Grade Presets */}
        <div className="flex flex-wrap gap-2 mb-3">
          {GRADE_PRESETS.map(({ label, prompt: presetPrompt }) => (
            <button
              key={label}
              onClick={() => setPrompt(presetPrompt)}
              disabled={isConverting}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                prompt === presetPrompt
                  ? "bg-blue-500 text-white shadow-md shadow-blue-500/25"
                  : "bg-white/50 text-slate-500 hover:bg-white/70 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Prompt History & Favorites */}
        {promptHistory.length > 0 && (
          <div className="border-t border-slate-200/50 pt-3">
            <button
              onClick={() => setShowPromptHistory(!showPromptHistory)}
              className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors w-full"
            >
              <History className="w-4 h-4" />
              <span>Prompt History</span>
              <span className="text-xs font-normal text-slate-400 ml-1">
                ({promptHistory.length})
              </span>
              {showPromptHistory ? (
                <ChevronUp className="w-4 h-4 ml-auto" />
              ) : (
                <ChevronDown className="w-4 h-4 ml-auto" />
              )}
            </button>

            <AnimatePresence>
              {showPromptHistory && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-1 max-h-64 overflow-y-auto">
                    {/* Favorites first, then recent */}
                    {[...promptHistory]
                      .sort((a, b) => {
                        if (a.isFavorite !== b.isFavorite)
                          return a.isFavorite ? -1 : 1;
                        return b.usedAt - a.usedAt;
                      })
                      .map(item => (
                        <div
                          key={item.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all group cursor-pointer ${
                            prompt === item.text
                              ? "bg-blue-50/80 border border-blue-200/60"
                              : "hover:bg-white/50"
                          }`}
                          onClick={() => {
                            setPrompt(item.text);
                          }}
                        >
                          {/* Favorite toggle */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              togglePromptFavorite(item.id);
                            }}
                            className="shrink-0 p-1.5 -m-1.5 transition-colors rounded"
                            aria-label={
                              item.isFavorite
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                          >
                            <Star
                              className={`w-3.5 h-3.5 ${
                                item.isFavorite
                                  ? "fill-amber-400 text-amber-400"
                                  : "text-slate-300 group-hover:text-slate-400"
                              }`}
                            />
                          </button>

                          {/* Prompt text */}
                          <span className="text-sm text-slate-600 truncate flex-1">
                            {item.text}
                          </span>

                          {/* Use count badge */}
                          {item.useCount > 1 && (
                            <span className="text-xs font-medium text-slate-400 bg-slate-100/60 px-1.5 py-0.5 rounded-full shrink-0">
                              {item.useCount}x
                            </span>
                          )}

                          {/* Delete button */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              removePromptFromHistory(item.id);
                            }}
                            className="shrink-0 p-1.5 -m-1.5 text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded"
                            aria-label="Remove from history"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Progress */}
      {isConverting && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-5 card-shadow mb-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
              <span className="text-sm font-semibold text-slate-700">
                Converting photos...
              </span>
            </div>
            <span className="text-sm font-mono text-slate-500">
              {Math.round(progress)}%
            </span>
          </div>
          <Progress value={progress} className="h-2 rounded-full" />
          {cooldownSeconds > 0 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Rate limited — waiting {cooldownSeconds}s before next attempt...
            </p>
          )}
        </motion.div>
      )}

      {/* Results */}
      {convertedPhotos.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-5 card-shadow mb-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-700">
                Conversion Results
              </h3>
              <p className="text-sm text-slate-400 mt-0.5">
                {doneCount} converted
                {errorCount > 0 && (
                  <span className="text-red-400"> · {errorCount} failed</span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Retry failed button */}
              {errorCount > 0 && !isConverting && (
                <Button
                  onClick={retryFailed}
                  disabled={cooldownSeconds > 0}
                  variant="outline"
                  size="sm"
                  className="glass rounded-xl text-amber-600 hover:bg-amber-50/50 hover:text-amber-700"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Retry Failed ({errorCount})
                </Button>
              )}
              {doneCount > 0 && (
                <>
                  <Button
                    onClick={async () => {
                      await transferAllToGallery();
                      toast.success(
                        `Transferred ${doneCount} photos to gallery`
                      );
                    }}
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white rounded-full h-9 px-4 text-sm font-semibold shadow-lg shadow-emerald-500/25"
                  >
                    <Images className="w-4 h-4 mr-2" />
                    Transfer All to Gallery
                  </Button>
                  <Button
                    onClick={handleDownloadAll}
                    disabled={isDownloadingAll}
                    variant="outline"
                    className="glass rounded-full h-9 px-4 text-sm font-semibold text-blue-600 hover:bg-blue-50/50 hover:text-blue-700"
                  >
                    {isDownloadingAll ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4 mr-2" />
                    )}
                    Download All
                  </Button>
                  <Link href="/gallery">
                    <Button
                      variant="outline"
                      className="glass rounded-xl h-10 text-slate-600 hover:bg-white/60"
                    >
                      View Gallery
                      <ArrowRight className="w-4 h-4 ml-1.5" />
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <AnimatePresence>
              {convertedPhotos.map(photo => (
                <motion.div
                  key={photo.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="relative rounded-xl overflow-hidden aspect-square group"
                >
                  <img
                    src={
                      photo.status === "done"
                        ? photo.convertedUrl
                        : photo.originalPreview
                    }
                    alt={photo.originalName}
                    className="w-full h-full object-cover"
                  />

                  {/* Status overlay */}
                  {photo.status === "converting" && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full border-3 border-white/30 border-t-white animate-spin" />
                    </div>
                  )}
                  {photo.status === "pending" && (
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                      <span className="text-xs font-semibold text-white bg-black/40 px-3 py-1 rounded-full">
                        Pending
                      </span>
                    </div>
                  )}
                  {photo.status === "done" && (
                    <div className="absolute top-2 right-2">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400 drop-shadow-lg" />
                    </div>
                  )}
                  {photo.status === "error" && (
                    <div className="absolute inset-0 bg-red-900/40 flex flex-col items-center justify-center p-2">
                      <AlertCircle className="w-6 h-6 text-red-300 mb-1.5" />
                      <span className="text-xs text-red-200 font-medium text-center leading-tight max-w-full px-1">
                        {photo.error || "Failed"}
                      </span>
                    </div>
                  )}

                  {/* Name overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-[11px] text-white truncate font-medium">
                      {photo.originalName}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      <Dialog
        open={!!limitDialog}
        onOpenChange={open => !open && setLimitDialog(null)}
      >
        <DialogContent className="glass-strong rounded-2xl border-white/30 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-800">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <Ban className="w-4 h-4 text-white" />
              </div>
              {limitDialog?.title || "Gemini safety cap"}
            </DialogTitle>
            <DialogDescription className="text-slate-500">
              {limitDialog?.message}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white/55 rounded-xl p-3 border border-white/40">
                <div className="text-[10px] uppercase font-semibold text-slate-400">
                  Batch
                </div>
                <div className="text-lg font-bold text-slate-700">
                  {MAX_BATCH_SIZE}
                </div>
              </div>
              <div className="bg-white/55 rounded-xl p-3 border border-white/40">
                <div className="text-[10px] uppercase font-semibold text-slate-400">
                  User left
                </div>
                <div className="text-lg font-bold text-slate-700">
                  {limitDialog?.usage?.userRemaining ??
                    usageQuery.data?.userRemaining ??
                    MAX_IMAGES_PER_USER_PER_DAY}
                </div>
              </div>
              <div className="bg-white/55 rounded-xl p-3 border border-white/40">
                <div className="text-[10px] uppercase font-semibold text-slate-400">
                  Project left
                </div>
                <div className="text-lg font-bold text-slate-700">
                  {limitDialog?.usage?.globalRemaining ??
                    usageQuery.data?.globalRemaining ??
                    MAX_IMAGES_PER_DAY}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              GradeFlow blocks the request before it reaches Gemini when these
              caps are hit. Daily counters follow Gemini's Pacific-time quota
              day.
            </p>

            <Button
              onClick={() => setLimitDialog(null)}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl h-10 font-semibold"
            >
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ApiKeyDialog open={showApiDialog} onOpenChange={setShowApiDialog} />
    </div>
  );
}
