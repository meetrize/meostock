"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { HeatmapMessages, Locale } from "@/lib/i18n";
import type { WatchlistExchange, WatchlistItem } from "@/lib/watchlist";
import {
  classifyWatchlistAiError,
  compressImageForVision,
  formatWatchlistAiErrorDetail,
  isWatchlistAiConfigured,
  loadWatchlistAiConfig,
  matchRecognizedStocks,
  recognizeStocksFromScreenshot,
  saveWatchlistAiConfig,
  type MatchedWatchlistCandidate,
  type WatchlistAiConfig,
} from "@/lib/watchlist-ai";

function formatExchange(exchange: WatchlistExchange | undefined, locale: Locale) {
  if (!exchange) {
    return "";
  }

  if (locale === "en") {
    if (exchange === "SH") return "SSE";
    if (exchange === "SZ") return "SZSE";
    return "BSE";
  }

  if (exchange === "SH") return "上交所";
  if (exchange === "SZ") return "深交所";
  return "北交所";
}

function inferExchange(code: string, fallback?: WatchlistExchange): WatchlistExchange | undefined {
  if (fallback) {
    return fallback;
  }

  const match = code.toUpperCase().match(/\.(\w+)$/);
  if (match?.[1] === "SH" || match?.[1] === "SZ" || match?.[1] === "BJ") {
    return match[1];
  }

  return undefined;
}

function formatSector(boardName?: string, subBoardName?: string) {
  const board = boardName?.trim() ?? "";
  const subBoard = subBoardName?.trim() ?? "";
  if (board && subBoard && subBoard !== board) {
    return `${board} / ${subBoard}`;
  }

  return board || subBoard;
}

function formatHint(hint: MatchedWatchlistCandidate["hint"]) {
  return [hint.name, hint.code].filter(Boolean).join(" · ");
}

function aiErrorMessage(messages: HeatmapMessages, error: unknown) {
  const kind = classifyWatchlistAiError(error);
  if (kind === "cors") return messages.watchlistAiErrorCors;
  if (kind === "config") return messages.watchlistAiErrorConfig;
  if (kind === "network") return messages.watchlistAiErrorNetwork;
  if (kind === "parse") return messages.watchlistAiErrorParse;
  if (kind === "image") return messages.watchlistAiErrorImage;
  return messages.watchlistAiErrorUnknown;
}

export function WatchlistAiDialog({
  open,
  messages,
  locale,
  items,
  onAdd,
  onClose,
}: {
  open: boolean;
  messages: HeatmapMessages;
  locale: Locale;
  items: WatchlistItem[];
  onAdd: (item: WatchlistItem) => boolean;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);

  const [aiConfig, setAiConfig] = useState<WatchlistAiConfig>(() => loadWatchlistAiConfig());
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [aiPhase, setAiPhase] = useState<"idle" | "preparing" | "recognizing" | "matching">("idle");
  const [aiDragOver, setAiDragOver] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiErrorDetail, setAiErrorDetail] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchedWatchlistCandidate[]>([]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set());
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const addedCodes = new Set(items.map((item) => item.code));
  const aiConfigured = isWatchlistAiConfigured(aiConfig);
  const aiRecognizing = aiPhase !== "idle";
  const matchedCandidates = candidates.filter((item) => item.match);
  const selectedMatchedCount = matchedCandidates.filter((item) => selectedCandidateIds.has(item.id)).length;
  const canStartRecognition = Boolean(pendingImage) && !aiRecognizing;
  const aiPhaseLabel =
    aiPhase === "preparing"
      ? messages.watchlistAiPreparing
      : aiPhase === "matching"
        ? messages.watchlistAiMatching
        : aiPhase === "recognizing"
          ? messages.watchlistAiRecognizing
          : null;

  const revokePreviewUrl = useCallback(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
  }, []);

  const clearAiResult = useCallback(() => {
    revokePreviewUrl();
    setAiError(null);
    setAiErrorDetail(null);
    setPreviewUrl(null);
    setPendingImage(null);
    setCandidates([]);
    setSelectedCandidateIds(new Set());
    setAiPhase("idle");
    setAiDragOver(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [revokePreviewUrl]);

  const resetAndClose = useCallback(() => {
    if (aiRecognizing) {
      return;
    }
    clearAiResult();
    setAiConfigOpen(false);
    setShowApiKey(false);
    onClose();
  }, [aiRecognizing, clearAiResult, onClose]);

  const stagePendingImage = useCallback(
    (file: Blob) => {
      if (!isWatchlistAiConfigured(aiConfig)) {
        setAiConfigOpen(true);
        setAiError(messages.watchlistAiNotConfigured);
        setAiErrorDetail(null);
        toast.message(messages.watchlistAiNeedConfigTitle, { id: "watchlist-ai" });
        return;
      }

      const mime = file.type.trim().toLowerCase();
      if (mime && !mime.startsWith("image/")) {
        setAiError(messages.watchlistAiErrorImage);
        setAiErrorDetail(mime);
        return;
      }

      revokePreviewUrl();
      setAiError(null);
      setAiErrorDetail(null);
      setCandidates([]);
      setSelectedCandidateIds(new Set());
      setAiPhase("idle");
      setPendingImage(file);

      const objectUrl = URL.createObjectURL(file);
      previewObjectUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
    },
    [aiConfig, messages.watchlistAiErrorImage, messages.watchlistAiNeedConfigTitle, messages.watchlistAiNotConfigured, revokePreviewUrl]
  );

  const runRecognition = useCallback(async () => {
    if (!pendingImage) {
      return;
    }

    if (!isWatchlistAiConfigured(aiConfig)) {
      setAiConfigOpen(true);
      setAiError(messages.watchlistAiNotConfigured);
      setAiErrorDetail(null);
      toast.message(messages.watchlistAiNotConfigured, { id: "watchlist-ai" });
      return;
    }

    setAiError(null);
    setAiErrorDetail(null);
    setCandidates([]);
    setSelectedCandidateIds(new Set());
    setAiPhase("preparing");

    try {
      const compressed = await compressImageForVision(pendingImage);
      revokePreviewUrl();
      setPreviewUrl(compressed.dataUrl);

      setAiPhase("recognizing");
      const hints = await recognizeStocksFromScreenshot(aiConfig, {
        base64: compressed.base64,
        mediaType: compressed.mediaType,
      });

      if (hints.length === 0) {
        setAiError(messages.watchlistAiNoStocks);
        setAiErrorDetail(null);
        return;
      }

      setAiPhase("matching");
      const matched = await matchRecognizedStocks(hints);
      setCandidates(matched);
      setSelectedCandidateIds(
        new Set(
          matched
            .filter((item) => item.match && !items.some((stock) => stock.code === item.match?.code))
            .map((item) => item.id)
        )
      );
    } catch (error) {
      console.error("[watchlist-ai]", error);
      setAiError(aiErrorMessage(messages, error));
      setAiErrorDetail(formatWatchlistAiErrorDetail(error));
    } finally {
      setAiPhase("idle");
    }
  }, [aiConfig, items, messages, pendingImage, revokePreviewUrl]);

  useEffect(() => {
    return () => {
      revokePreviewUrl();
    };
  }, [revokePreviewUrl]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const config = loadWatchlistAiConfig();
    setAiConfig(config);
    const configured = isWatchlistAiConfigured(config);
    setAiConfigOpen(!configured);
    if (!configured) {
      setAiError(messages.watchlistAiNotConfigured);
      setAiErrorDetail(null);
    }
  }, [messages.watchlistAiNotConfigured, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        resetAndClose();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, resetAndClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }

      const itemsList = event.clipboardData?.items;
      if (!itemsList) {
        return;
      }

      for (const item of itemsList) {
        if (!item.type.startsWith("image/")) {
          continue;
        }
        const file = item.getAsFile();
        if (!file) {
          continue;
        }
        event.preventDefault();
        stagePendingImage(file);
        return;
      }
    }

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [open, stagePendingImage]);

  if (!open) {
    return null;
  }

  function handleSaveAiConfig() {
    const next = {
      baseURL: aiConfig.baseURL.trim(),
      apiKey: aiConfig.apiKey.trim(),
      model: aiConfig.model.trim(),
    };
    setAiConfig(next);
    saveWatchlistAiConfig(next);
    toast.success(messages.watchlistAiSaved, { id: "watchlist-ai" });
    if (isWatchlistAiConfigured(next)) {
      setAiError(null);
      setAiErrorDetail(null);
      setAiConfigOpen(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      stagePendingImage(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setAiDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      stagePendingImage(file);
    }
  }

  function toggleCandidate(id: string) {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAllMatched() {
    setSelectedCandidateIds(
      new Set(matchedCandidates.filter((item) => item.match && !addedCodes.has(item.match.code)).map((item) => item.id))
    );
  }

  function addSelectedCandidates() {
    const selected = matchedCandidates.filter((item) => selectedCandidateIds.has(item.id) && item.match);
    if (selected.length === 0) {
      toast.message(messages.watchlistAiAddSelectedEmpty, { id: "watchlist-ai" });
      return;
    }

    let addedCount = 0;
    for (const item of selected) {
      if (!item.match) {
        continue;
      }
      const ok = onAdd({
        code: item.match.code,
        name: item.match.name,
        boardName: item.match.boardName,
        subBoardName: item.match.subBoardName,
        exchange: inferExchange(item.match.code, item.match.exchange),
      });
      if (ok) {
        addedCount += 1;
      }
    }

    if (addedCount > 0) {
      toast.success(messages.watchlistAiAddSuccess.replace("{count}", String(addedCount)), {
        id: "watchlist-ai",
      });
      clearAiResult();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[10020] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="watchlist-ai-dialog-title"
    >
      <button type="button" className="absolute inset-0" aria-label={messages.closeSheet} onClick={resetAndClose} />

      <section className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-lg border border-border bg-card text-card-foreground shadow-[0_-20px_80px_rgba(0,0,0,0.45)] sm:rounded-lg sm:border">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-4 shrink-0 text-muted-foreground" />
              <h2 id="watchlist-ai-dialog-title" className="text-base font-semibold leading-tight">
                {messages.watchlistAiTitle}
              </h2>
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{messages.watchlistAiIntro}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAiConfigOpen((value) => !value)}
              aria-pressed={aiConfigOpen}
              aria-label={messages.watchlistAiConfigure}
              title={messages.watchlistAiConfigure}
              className={cn(
                "inline-flex size-9 items-center justify-center border transition-colors",
                aiConfigOpen || !aiConfigured
                  ? "border-brand/55 bg-brand/14 text-foreground"
                  : "border-border bg-background/70 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Settings2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={resetAndClose}
              disabled={aiRecognizing}
              aria-label={messages.closeSheet}
              className="inline-flex size-9 items-center justify-center border border-border bg-background/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {aiConfigOpen && (
            <div className="space-y-2 border border-border bg-muted/15 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[12px] font-semibold text-foreground">{messages.watchlistAiConfigure}</h3>
                <button
                  type="button"
                  onClick={() => setAiConfigOpen(false)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {messages.watchlistAiHideConfig}
                  <ChevronDown className="size-3.5 rotate-180" />
                </button>
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">{messages.watchlistAiCorsNote}</p>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground">{messages.watchlistAiBaseUrl}</span>
                <input
                  value={aiConfig.baseURL}
                  onChange={(event) => setAiConfig((current) => ({ ...current, baseURL: event.target.value }))}
                  placeholder={messages.watchlistAiBaseUrlPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 w-full border border-border bg-background px-2 text-[12px] outline-none focus:border-brand/55"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground">{messages.watchlistAiApiKey}</span>
                <div className="flex h-8 items-center border border-border bg-background">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={aiConfig.apiKey}
                    onChange={(event) => setAiConfig((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder={messages.watchlistAiApiKeyPlaceholder}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-full min-w-0 flex-1 bg-transparent px-2 text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((value) => !value)}
                    className="inline-flex h-full items-center gap-1 border-l border-border px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    {showApiKey ? messages.watchlistAiHideKey : messages.watchlistAiShowKey}
                  </button>
                </div>
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground">{messages.watchlistAiModel}</span>
                <input
                  value={aiConfig.model}
                  onChange={(event) => setAiConfig((current) => ({ ...current, model: event.target.value }))}
                  placeholder={messages.watchlistAiModelPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 w-full border border-border bg-background px-2 text-[12px] outline-none focus:border-brand/55"
                />
              </label>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveAiConfig}
                  className="h-8 border border-brand/55 bg-brand/14 px-3 text-[12px] font-semibold text-foreground transition-colors hover:bg-brand/22"
                >
                  {messages.watchlistAiSave}
                </button>
              </div>
            </div>
          )}

          {!previewUrl ? (
            !aiConfigured ? (
              <div className="flex min-h-44 flex-col items-center justify-center gap-3 border border-dashed border-brand/40 bg-brand/8 px-4 py-8 text-center">
                <Settings2 className="size-8 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">{messages.watchlistAiNeedConfigTitle}</p>
                  <p className="text-[12px] leading-5 text-muted-foreground">{messages.watchlistAiNotConfigured}</p>
                </div>
                {!aiConfigOpen && (
                  <button
                    type="button"
                    onClick={() => setAiConfigOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 border border-brand/55 bg-brand/14 px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-brand/22"
                  >
                    <Settings2 className="size-3.5" />
                    {messages.watchlistAiNeedConfigAction}
                  </button>
                )}
              </div>
            ) : (
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setAiDragOver(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setAiDragOver(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setAiDragOver(false);
                  }
                }}
                onDrop={handleDrop}
                className={cn(
                  "flex min-h-44 flex-col items-center justify-center gap-3 border border-dashed px-4 py-8 text-center transition-colors",
                  aiDragOver ? "border-brand/60 bg-brand/10" : "border-border bg-muted/10"
                )}
              >
                <ImagePlus className="size-8 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{messages.watchlistAiDropHint}</p>
                  <p className="text-[12px] text-muted-foreground">{messages.watchlistAiPasteHint}</p>
                </div>
                <button
                  type="button"
                  disabled={aiRecognizing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <ImagePlus className="size-3.5" />
                  {messages.watchlistAiUpload}
                </button>
              </div>
            )
          ) : (
            <div className="space-y-3">
              <div className="relative overflow-hidden border border-border bg-background">
                <img
                  src={previewUrl}
                  alt=""
                  className={cn("max-h-56 w-full object-contain transition-opacity", aiRecognizing && "opacity-55")}
                />

                {aiRecognizing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 px-3 text-center backdrop-blur-[1px]">
                    <Loader2 className="size-6 animate-spin text-brand" />
                    <p className="text-[13px] font-medium text-foreground">{aiPhaseLabel}</p>
                    <div className="h-1 w-32 overflow-hidden bg-muted">
                      <div
                        className={cn(
                          "h-full bg-brand transition-all duration-500",
                          aiPhase === "preparing" && "w-1/3",
                          aiPhase === "recognizing" && "w-2/3",
                          aiPhase === "matching" && "w-full"
                        )}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={clearAiResult}
                  disabled={aiRecognizing}
                  aria-label={messages.watchlistAiDismiss}
                  title={messages.watchlistAiDismiss}
                  className="absolute right-2 top-2 inline-flex size-8 items-center justify-center border border-border bg-background/90 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {pendingImage && !aiRecognizing && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void runRecognition();
                    }}
                    disabled={!canStartRecognition}
                    className="inline-flex h-9 items-center gap-1.5 border border-brand/55 bg-brand/14 px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-brand/22 disabled:opacity-60"
                  >
                    <Sparkles className="size-3.5" />
                    {candidates.length > 0 || aiError ? messages.watchlistAiRetry : messages.watchlistAiRecognize}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ImagePlus className="size-3.5" />
                    {messages.watchlistAiUpload}
                  </button>
                  <span className="text-[11px] text-muted-foreground">{messages.watchlistAiReady}</span>
                </div>
              )}

              {aiRecognizing && (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 border border-brand/35 bg-brand/8 px-3 py-2.5 text-[13px] text-foreground"
                >
                  <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                  <span>{aiPhaseLabel}</span>
                </div>
              )}

              {aiError && !aiRecognizing && (
                <div className="space-y-1 border border-destructive/35 bg-destructive/8 px-3 py-2.5">
                  <p className="text-[13px] leading-5 text-foreground">{aiError}</p>
                  {aiErrorDetail && (
                    <p className="break-words font-mono text-[10px] leading-4 text-muted-foreground">{aiErrorDetail}</p>
                  )}
                </div>
              )}

              {candidates.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-foreground">{messages.watchlistAiCandidatesTitle}</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllMatched}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        {messages.watchlistAiSelectAll}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCandidateIds(new Set())}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        {messages.watchlistAiClearSelection}
                      </button>
                    </div>
                  </div>

                  <div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain border border-border">
                    {candidates.map((item) => {
                      const matched = item.match;
                      const alreadyAdded = matched ? addedCodes.has(matched.code) : false;
                      const selectable = Boolean(matched) && !alreadyAdded;
                      const checked = selectedCandidateIds.has(item.id);

                      return (
                        <label
                          key={item.id}
                          className={cn(
                            "flex items-start gap-2 border-b border-border px-2.5 py-2 last:border-b-0",
                            selectable ? "cursor-pointer bg-background hover:bg-muted/50" : "bg-muted/20"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            disabled={!selectable}
                            checked={checked && selectable}
                            onChange={() => toggleCandidate(item.id)}
                          />
                          <span className="min-w-0 flex-1">
                            {matched ? (
                              <>
                                <span className="block truncate text-[13px] font-semibold text-foreground">
                                  {matched.name}
                                  {alreadyAdded ? (
                                    <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">
                                      {messages.watchlistAlreadyAdded}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                  {[
                                    matched.code,
                                    formatExchange(inferExchange(matched.code, matched.exchange), locale),
                                    formatSector(matched.boardName, matched.subBoardName),
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="block truncate text-[13px] font-semibold text-muted-foreground">
                                  {formatHint(item.hint) || messages.watchlistAiUnmatched}
                                </span>
                                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                  {messages.watchlistAiUnmatched}
                                </span>
                              </>
                            )}
                            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground/80">
                              {messages.watchlistAiHintLabel}: {formatHint(item.hint) || "--"}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {candidates.length > 0 && !aiRecognizing && (
          <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-card px-4 py-3">
            <button
              type="button"
              onClick={addSelectedCandidates}
              disabled={selectedMatchedCount === 0}
              className="inline-flex h-9 items-center gap-1.5 border border-brand/55 bg-brand/14 px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-brand/22 disabled:opacity-50"
            >
              <Check className="size-3.5" />
              {messages.watchlistAiAddSelected.replace("{count}", String(selectedMatchedCount))}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
