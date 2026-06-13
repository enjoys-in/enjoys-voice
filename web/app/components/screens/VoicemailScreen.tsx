"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Voicemail as VoicemailIcon,
  RefreshCw,
  Trash2,
  Play,
  Pause,
  Phone,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../ui/EmptyState";
import { ListScreenSkeleton } from "./ScreenSkeletons";
import { useAuthStore, useVoicemailStore } from "../../stores";
import { api } from "../../lib/api";
import { getCachedVoicemailUrl, invalidateCachedVoicemail } from "../../lib/voicemail-cache";
import { formatPhone } from "../../lib/phone";

interface VoicemailScreenProps {
  onCall?: (target: string, name?: string) => void;
}

export function VoicemailScreen({ onCall }: VoicemailScreenProps) {
  const { user } = useAuthStore();
  const ext = user?.extension;
  const { voicemails, loading, fetchVoicemails, markRead, remove } = useVoicemailStore();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Blob URL currently driving <audio>; revoked when playback stops so cached
  // recordings (which can be several MB) don't pile up in memory.
  const objectUrlRef = useRef<string | null>(null);
  // The id the user most recently asked to play. Lets the async cache lookup
  // bail if the user toggled off / switched messages before it resolved.
  const pendingIdRef = useRef<string | null>(null);

  // TTL-guarded in the store: if AppShell already loaded recently, this mount
  // reuses the cache instead of firing a second request. The refresh button
  // forces a fresh fetch.
  const refresh = useCallback(
    (force = false) => {
      if (!ext) return;
      fetchVoicemails(ext, force);
    },
    [ext, fetchVoicemails]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Stop playback, release the <audio>, and revoke any blob URL we minted.
  const teardownAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // Clean up audio on unmount.
  useEffect(() => {
    return () => {
      teardownAudio();
      pendingIdRef.current = null;
    };
  }, [teardownAudio]);

  const togglePlay = useCallback(
    (id: string) => {
      if (!ext) return;

      // Toggle off if the same message is playing.
      if (playingId === id) {
        pendingIdRef.current = null;
        teardownAudio();
        setPlayingId(null);
        return;
      }

      // Switching messages: stop the current one, mark this id as the request.
      teardownAudio();
      pendingIdRef.current = id;

      // Mark as read locally + on the server (independent of playback).
      markRead(id);
      api.markVoicemailRead(ext, id).catch(() => {});

      // First play fetches + caches the recording; later plays are served from
      // Cache Storage with no backend hit. Bail if the user toggled away while
      // it was still loading.
      void (async () => {
        const url = await getCachedVoicemailUrl(api.voicemailAudioUrl(ext, id));
        if (pendingIdRef.current !== id) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url.startsWith("blob:") ? url : null;
        const audio = new Audio(url);
        audioRef.current = audio;
        const onDone = () => {
          if (pendingIdRef.current === id) pendingIdRef.current = null;
          teardownAudio();
          setPlayingId(null);
        };
        audio.onended = onDone;
        audio.onerror = onDone;
        audio.play().then(() => setPlayingId(id), onDone);
      })();
    },
    [ext, playingId, markRead, teardownAudio]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!ext) return;
      if (playingId === id) {
        pendingIdRef.current = null;
        teardownAudio();
        setPlayingId(null);
      }
      // Evict the cached recording from the browser too — it's gone for good.
      void invalidateCachedVoicemail(api.voicemailAudioUrl(ext, id));
      remove(id);
      try {
        await api.deleteVoicemail(ext, id);
      } catch {
        /* ignore */
      }
    },
    [ext, playingId, remove, teardownAudio]
  );

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Voicemail</h1>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => refresh(true)}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-1">
          {voicemails.length === 0 && loading ? (
            <ListScreenSkeleton rows={5} />
          ) : voicemails.length === 0 && !loading ? (
            <EmptyState
              icon={<VoicemailIcon className="h-12 w-12" />}
              title="No voicemail"
              description="Messages from missed calls will appear here."
            />
          ) : (
            voicemails.map((vm) => {
              const label = vm.fromName?.trim() || formatPhone(vm.from);
              const isPlaying = playingId === vm.id;
              return (
                <div
                  key={vm.id}
                  className="flex items-center gap-3 py-2.5 px-1 rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="text-xs bg-muted">
                        {getInitials(label)}
                      </AvatarFallback>
                    </Avatar>
                    {!vm.read && (
                      <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-primary border-2 border-background" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${vm.read ? "font-medium" : "font-semibold"}`}>
                      {label}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatTime(vm.createdAt)}
                      {vm.duration ? ` · ${formatDuration(vm.duration)}` : ""}
                    </p>
                  </div>

                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-primary"
                    onClick={() => togglePlay(vm.id)}
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  </Button>

                  {onCall && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 text-emerald-600"
                      onClick={() => onCall(vm.from, label)}
                      title="Call back"
                    >
                      <Phone className="h-5 w-5" />
                    </Button>
                  )}

                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(vm.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
