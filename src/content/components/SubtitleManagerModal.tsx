import { useState, useRef, type ReactElement } from 'react';
import { Check, FileText, Link, Upload, X, AlertCircle, RefreshCw } from 'lucide-react';
import type { DetectedSubtitleTrack } from '../subtitleDetector';
import { fetchSubtitleContent, parseSubtitlesText, extractCuesFromTextTrack } from '../subtitleDetector';
import type { Json3Response } from '../../types/subtitles';

interface SubtitleManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  detectedTracks: DetectedSubtitleTrack[];
  activeTrackLang?: string;
  activeCueCount?: number;
  onLoadSubtitles: (payload: { data: Json3Response; lang: string; source: string }) => void;
  onRefreshDetectedTracks: () => void;
}

export function SubtitleManagerModal({
  isOpen,
  onClose,
  detectedTracks,
  activeTrackLang,
  activeCueCount,
  onLoadSubtitles,
  onRefreshDetectedTracks
}: SubtitleManagerModalProps): ReactElement | null {
  const [tab, setTab] = useState<'detected' | 'url' | 'file' | 'paste'>('detected');
  const [customUrl, setCustomUrl] = useState('');
  const [customLang, setCustomLang] = useState('auto');
  const [pasteText, setPasteText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const showFeedback = (success: string | null, error: string | null) => {
    setSuccessMessage(success);
    setErrorMessage(error);
    if (success) {
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  const handleLoadFromUrl = async () => {
    const trimmed = customUrl.trim();
    if (!trimmed) {
      showFeedback(null, 'Please enter a valid subtitle URL');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const text = await fetchSubtitleContent(trimmed);
      const data = parseSubtitlesText(text);
      if (!data.events || data.events.length === 0) {
        throw new Error('No valid subtitle cues found in file');
      }

      let lang = customLang.trim() || 'auto';
      if (lang === 'auto') {
        const langMatch = trimmed.match(/[/._-]([a-z]{2}(?:-[a-z]{2})?)[/._-]/i);
        if (langMatch?.[1]) lang = langMatch[1].toLowerCase();
      }

      onLoadSubtitles({
        data,
        lang,
        source: trimmed
      });
      showFeedback(`Loaded ${data.events.length} cues successfully!`, null);
    } catch (err: unknown) {
      showFeedback(null, err instanceof Error ? err.message : 'Failed to load subtitles');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const data = parseSubtitlesText(text);
        if (!data.events || data.events.length === 0) {
          throw new Error('No valid subtitle cues found in uploaded file');
        }

        let lang = customLang.trim() || 'auto';
        if (lang === 'auto') {
          const match = file.name.match(/[/._-]([a-z]{2}(?:-[a-z]{2})?)[/._-]/i);
          if (match?.[1]) lang = match[1].toLowerCase();
        }

        onLoadSubtitles({
          data,
          lang,
          source: file.name
        });
        showFeedback(`Loaded ${data.events.length} cues from ${file.name}!`, null);
      } catch (err: unknown) {
        showFeedback(null, err instanceof Error ? err.message : 'Invalid subtitle format');
      } finally {
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
      showFeedback(null, 'Failed to read local file');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };

  const handleApplyPasteText = () => {
    const trimmed = pasteText.trim();
    if (!trimmed) {
      showFeedback(null, 'Please paste subtitle content');
      return;
    }

    try {
      const data = parseSubtitlesText(trimmed);
      if (!data.events || data.events.length === 0) {
        throw new Error('No valid subtitle cues found');
      }
      onLoadSubtitles({
        data,
        lang: customLang.trim() || 'auto',
        source: 'Pasted text'
      });
      showFeedback(`Loaded ${data.events.length} cues!`, null);
    } catch (err: unknown) {
      showFeedback(null, err instanceof Error ? err.message : 'Parsing error');
    }
  };

  const handleSelectDetectedTrack = async (track: DetectedSubtitleTrack) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      if (track.source === 'textTrack') {
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video?.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            const tt = video.textTracks[i];
            const ttId = `tt-${tt.id || tt.label || tt.language || i}`;
            if (ttId === track.id) {
              const data = extractCuesFromTextTrack(tt);
              if (data && data.events && data.events.length > 0) {
                onLoadSubtitles({
                  data,
                  lang: track.language || 'auto',
                  source: track.label
                });
                showFeedback(`Loaded ${data.events.length} cues!`, null);
                return;
              }
            }
          }
        }
      }

      if (track.url) {
        const text = await fetchSubtitleContent(track.url);
        const data = parseSubtitlesText(text);
        if (data.events && data.events.length > 0) {
          onLoadSubtitles({
            data,
            lang: track.language || 'auto',
            source: track.label
          });
          showFeedback(`Loaded ${data.events.length} cues!`, null);
          return;
        }
      }

      throw new Error('Could not extract cues from selected track');
    } catch (err: unknown) {
      showFeedback(null, err instanceof Error ? err.message : 'Failed to load detected track');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="absolute right-3 top-12 z-30 w-80 rounded-xl p-3 shadow-2xl pointer-events-auto select-none border text-xs"
      style={{
        backgroundColor: `rgba(var(--ytai-bg-rgb), 0.96)`,
        borderColor: 'var(--ytai-border)',
        backdropFilter: 'blur(var(--ytai-backdrop-blur, 16px))',
        WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 16px))',
        color: 'var(--ytai-text-primary)'
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--ytai-border)]">
        <div className="flex items-center gap-1.5 font-semibold">
          <FileText className="h-4 w-4 text-[var(--ytai-accent)]" />
          <span>Subtitle Source</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 hover:bg-[var(--ytai-surface)] text-[var(--ytai-text-secondary)] hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Active Track Info */}
      {activeTrackLang && (
        <div className="mt-2 flex items-center justify-between rounded-lg px-2.5 py-1.5 bg-[var(--ytai-surface)] border border-[var(--ytai-border)]">
          <div className="flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-medium text-[var(--ytai-text-primary)]">
              Active: {activeTrackLang.toUpperCase()}
            </span>
          </div>
          {typeof activeCueCount === 'number' && (
            <span className="text-[var(--ytai-text-secondary)]">{activeCueCount} cues</span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="mt-2.5 flex rounded-lg p-0.5 bg-[var(--ytai-surface)] gap-0.5 border border-[var(--ytai-border)]">
        <button
          type="button"
          onClick={() => { setTab('detected'); onRefreshDetectedTracks(); }}
          className={`flex-1 rounded py-1 text-center font-medium transition ${
            tab === 'detected'
              ? 'bg-[var(--ytai-accent)] text-white'
              : 'text-[var(--ytai-text-secondary)] hover:text-white'
          }`}
        >
          Player
        </button>
        <button
          type="button"
          onClick={() => setTab('url')}
          className={`flex-1 rounded py-1 text-center font-medium transition ${
            tab === 'url'
              ? 'bg-[var(--ytai-accent)] text-white'
              : 'text-[var(--ytai-text-secondary)] hover:text-white'
          }`}
        >
          URL
        </button>
        <button
          type="button"
          onClick={() => setTab('file')}
          className={`flex-1 rounded py-1 text-center font-medium transition ${
            tab === 'file'
              ? 'bg-[var(--ytai-accent)] text-white'
              : 'text-[var(--ytai-text-secondary)] hover:text-white'
          }`}
        >
          File
        </button>
        <button
          type="button"
          onClick={() => setTab('paste')}
          className={`flex-1 rounded py-1 text-center font-medium transition ${
            tab === 'paste'
              ? 'bg-[var(--ytai-accent)] text-white'
              : 'text-[var(--ytai-text-secondary)] hover:text-white'
          }`}
        >
          Paste
        </button>
      </div>

      {/* Tab Contents */}
      <div className="mt-3 min-h-[100px]">
        {tab === 'detected' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-[var(--ytai-text-secondary)]">Detected in page/player:</span>
              <button
                type="button"
                onClick={onRefreshDetectedTracks}
                className="flex items-center gap-1 text-[11px] text-[var(--ytai-accent)] hover:underline"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Scan</span>
              </button>
            </div>

            {detectedTracks.length === 0 ? (
              <div className="py-4 text-center text-[var(--ytai-text-secondary)]">
                No tracks detected yet in video player.
                <div className="mt-1 text-[10px]">Try starting playback or use the URL tab.</div>
              </div>
            ) : (
              <div className="max-h-36 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {detectedTracks.map((tr) => (
                  <div
                    key={tr.id}
                    className="flex items-center justify-between rounded-md p-1.5 bg-[var(--ytai-surface)] border border-[var(--ytai-border)]"
                  >
                    <div className="flex flex-col truncate pr-2">
                      <span className="font-medium truncate">{tr.label}</span>
                      <span className="text-[10px] text-[var(--ytai-text-secondary)] uppercase">
                        {tr.language} · {tr.source}
                        {tr.cueCount ? ` · ${tr.cueCount} cues` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleSelectDetectedTrack(tr)}
                      className="rounded bg-[var(--ytai-accent)] px-2 py-0.5 text-[11px] text-white hover:opacity-90 transition shrink-0"
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'url' && (
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] text-[var(--ytai-text-secondary)] mb-1">
                Direct .vtt or .srt URL:
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="https://example.com/subs.vtt"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  className="w-full rounded bg-[var(--ytai-surface)] border border-[var(--ytai-border)] px-2 py-1 text-xs outline-none focus:border-[var(--ytai-accent)] text-[var(--ytai-text-primary)]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-[11px] text-[var(--ytai-text-secondary)] mb-1">
                  Language code:
                </label>
                <input
                  type="text"
                  placeholder="sv / en / auto"
                  value={customLang}
                  onChange={(e) => setCustomLang(e.target.value)}
                  className="w-full rounded bg-[var(--ytai-surface)] border border-[var(--ytai-border)] px-2 py-1 text-xs outline-none focus:border-[var(--ytai-accent)] text-[var(--ytai-text-primary)]"
                />
              </div>
              <div className="self-end">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={handleLoadFromUrl}
                  className="flex items-center gap-1 rounded bg-[var(--ytai-accent)] px-3 py-1 font-medium text-white hover:opacity-90 transition disabled:opacity-50"
                >
                  <Link className="h-3 w-3" />
                  <span>{isLoading ? 'Loading...' : 'Load'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'file' && (
          <div className="space-y-2">
            <input
              type="file"
              ref={fileInputRef}
              accept=".vtt,.srt"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              type="button"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-[var(--ytai-border)] py-4 text-center hover:border-[var(--ytai-accent)] transition bg-[var(--ytai-surface)]"
            >
              <Upload className="h-5 w-5 text-[var(--ytai-accent)]" />
              <span className="font-medium text-xs">Choose .vtt or .srt file</span>
              <span className="text-[10px] text-[var(--ytai-text-secondary)]">Click to browse local files</span>
            </button>
          </div>
        )}

        {tab === 'paste' && (
          <div className="space-y-2">
            <textarea
              placeholder="Paste raw WebVTT or SRT content here..."
              rows={4}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              className="w-full rounded bg-[var(--ytai-surface)] border border-[var(--ytai-border)] p-2 text-xs outline-none focus:border-[var(--ytai-accent)] text-[var(--ytai-text-primary)] custom-scrollbar resize-none font-mono"
            />
            <button
              type="button"
              disabled={isLoading}
              onClick={handleApplyPasteText}
              className="w-full rounded bg-[var(--ytai-accent)] py-1 font-medium text-white hover:opacity-90 transition"
            >
              Apply Subtitles
            </button>
          </div>
        )}
      </div>

      {/* Status Messages */}
      {errorMessage && (
        <div className="mt-2.5 flex items-center gap-1.5 text-rose-400 text-[11px] bg-rose-950/40 border border-rose-800/60 rounded p-1.5">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="mt-2.5 flex items-center gap-1.5 text-emerald-400 text-[11px] bg-emerald-950/40 border border-emerald-800/60 rounded p-1.5">
          <Check className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{successMessage}</span>
        </div>
      )}
    </div>
  );
}
