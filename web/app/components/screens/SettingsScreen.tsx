"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut, Shield, PhoneForwarded, Volume2, Voicemail, Music, Radio, Mic, Play, Square, Upload, Trash2, Phone, Globe, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PhoneInput } from "../ui/PhoneInput";
import { useAuthStore, useSettingsStore } from "../../stores";
import { useSettingsSync } from "../../hooks/useSettingsSync";
import { getCachedSoundUrl, invalidateSoundCache } from "../../lib/sound-cache";
import { goApi } from "../../lib/go-api";

const CALLER_TUNES = [
  { id: "caller_tune.wav", name: "Default Tune" },
  { id: "ringback.wav", name: "Classic Ringback" },
  { id: "none", name: "No Tune (silence)" },
];

const RINGTONES = [
  { id: "ringtone.wav", name: "Default Ring" },
  { id: "ringback.wav", name: "Soft Ring" },
  { id: "busy_tone.wav", name: "Alert" },
];

export function SettingsScreen() {
  const { user, logout } = useAuthStore();
  const { settings, setSettings, setForwarding, addBlockedNumber, removeBlockedNumber } = useSettingsStore();
  const { saveForwarding, blockNumber, unblockNumber, savePstnForward } = useSettingsSync();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [customCallerTunes, setCustomCallerTunes] = useState<{ id: string; name: string }[]>([]);
  const [customRingtones, setCustomRingtones] = useState<{ id: string; name: string }[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "call" | "pstn">("general");

  // Account name editor (persisted server-side via the Go API, port 3003).
  const setUser = useAuthStore((s) => s.setUser);
  const [accountName, setAccountName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  // Keep the field in sync if the cached profile loads/refreshes (e.g. boot /me).
  useEffect(() => {
    setAccountName(user?.name ?? "");
  }, [user?.name]);

  const handleSaveName = async () => {
    const next = accountName.trim();
    if (!next || next === user?.name || savingName) return;
    setSavingName(true);
    setNameSaved(false);
    try {
      const updated = await goApi.auth.updateName(next);
      setUser(updated);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch {
      setAccountName(user?.name ?? ""); // revert on failure
    } finally {
      setSavingName(false);
    }
  };

  const handleDeleteAccount = () => {
    // TODO: call DELETE /api/users/:ext when backend supports it
    logout();
    setShowDeleteDialog(false);
  };

  const playPreview = async (file: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (playingId === file) {
      setPlayingId(null);
      return;
    }
    if (file === "none") return;
    const src = file.startsWith("blob:") ? file : await getCachedSoundUrl(`/sounds/${file}`);
    const audio = new Audio(src);
    audio.onended = () => setPlayingId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingId(file);
    // Auto-stop after 3 seconds
    setTimeout(() => {
      if (audioRef.current === audio) {
        audio.pause();
        audioRef.current = null;
        setPlayingId(null);
      }
    }, 3000);
  };

  const handleUpload = (type: "callerTune" | "ringtone") => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const entry = { id: url, name: file.name.replace(/\.[^.]+$/, "") };
      if (type === "callerTune") {
        setCustomCallerTunes((prev) => [...prev, entry]);
        setSettings({ callerTune: url });
      } else {
        setCustomRingtones((prev) => [...prev, entry]);
        setSettings({ ringtone: url });
      }
      // Invalidate sound cache so new uploads are fetched fresh
      invalidateSoundCache();
    };
    input.click();
  };

  const handleForwardingChange = (type: "busy" | "noAnswer" | "unavailable", value: string) => {
    const target = value || undefined;
    setForwarding(type, target);
    saveForwarding(type, target);
  };

  const handleBlock = (number: string) => {
    addBlockedNumber(number);
    blockNumber(number);
  };

  const handleUnblock = (number: string) => {
    removeBlockedNumber(number);
    unblockNumber(number);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="px-4 pb-3">
        <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
          {([
            { id: "general" as const, label: "General", icon: Settings2 },
            { id: "call" as const, label: "Call", icon: Phone },
            { id: "pstn" as const, label: "PSTN", icon: Globe },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium transition-colors ${
                activeTab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-4">
        <div className="space-y-4">

          {/* ─── General Tab ────────────────────────────────── */}
          {activeTab === "general" && (
            <>
              {/* Profile */}
              <Card className="border-border/50 bg-card/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold">
                      {(settings.displayName || user?.name)?.slice(0, 2).toUpperCase() || user?.extension}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{settings.displayName || user?.name || user?.extension}</p>
                      <p className="text-sm text-muted-foreground">ext. {user?.extension}</p>
                      {user?.mobile && <p className="text-xs text-muted-foreground">{user.mobile}</p>}
                    </div>
                  </div>

                  <Separator className="my-4" />

                  {/* Editable account name — persisted server-side (Go API). */}
                  <div className="space-y-1.5">
                    <Label htmlFor="accountName" className="text-sm">Name</Label>
                    <div className="flex gap-2">
                      <Input
                        id="accountName"
                        value={accountName}
                        placeholder={user?.extension || "Your name"}
                        onChange={(e) => { setAccountName(e.target.value); setNameSaved(false); }}
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); }}
                      />
                      <Button
                        onClick={handleSaveName}
                        disabled={savingName || !accountName.trim() || accountName.trim() === user?.name}
                      >
                        {savingName ? "Saving…" : nameSaved ? "Saved" : "Save"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Your account name, shown on your profile and in the app.
                    </p>
                  </div>

                  <Separator className="my-4" />

                  {/* Editable display name shown to people you call */}
                  <div className="space-y-1.5">
                    <Label htmlFor="displayName" className="text-sm">Display name</Label>
                    <Input
                      id="displayName"
                      value={settings.displayName || ""}
                      placeholder={user?.name || user?.extension || "Your name"}
                      onChange={(e) => setSettings({ displayName: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Shown as the caller name to people you call.
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Sounds & Tunes */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Volume2 className="h-4 w-4" /> Audio & Sounds
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="sounds" className="text-sm">Enable sounds</Label>
                    <Switch
                      id="sounds"
                      checked={settings.soundsEnabled}
                      onCheckedChange={(v) => setSettings({ soundsEnabled: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="dtmf" className="text-sm">DTMF keypad tones</Label>
                    <Switch
                      id="dtmf"
                      checked={settings.dtmfEnabled}
                      onCheckedChange={(v) => setSettings({ dtmfEnabled: v })}
                    />
                  </div>
                  <Separator className="opacity-50" />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Music className="h-3 w-3" /> Caller Tune
                    </Label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={settings.callerTune}
                        onValueChange={(v) => v && setSettings({ callerTune: v })}
                      >
                        <SelectTrigger className="bg-muted/50 flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...CALLER_TUNES, ...customCallerTunes].map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => playPreview(settings.callerTune)}
                        disabled={settings.callerTune === "none"}
                      >
                        {playingId === settings.callerTune ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => handleUpload("callerTune")}
                        title="Upload custom tune"
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Radio className="h-3 w-3" /> Ringtone
                    </Label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={settings.ringtone}
                        onValueChange={(v) => v && setSettings({ ringtone: v })}
                      >
                        <SelectTrigger className="bg-muted/50 flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...RINGTONES, ...customRingtones].map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => playPreview(settings.ringtone)}
                      >
                        {playingId === settings.ringtone ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => handleUpload("ringtone")}
                        title="Upload custom ringtone"
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Separator />

              {/* Delete Account */}
              <Button
                variant="outline"
                className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" /> Delete Account
              </Button>

              {/* Sign out (mobile only) */}
              <div className="lg:hidden">
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={logout}
                >
                  <LogOut className="h-4 w-4 mr-2" /> Sign Out
                </Button>
              </div>
            </>
          )}

          {/* ─── Call Settings Tab ──────────────────────────── */}
          {activeTab === "call" && (
            <>
              {/* Call Forwarding */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <PhoneForwarded className="h-4 w-4" /> Call Forwarding
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">On Busy</Label>
                    <Input
                      placeholder="Extension to forward to"
                      className="bg-muted/50"
                      value={settings.forwarding.busy || ""}
                      onChange={(e) => handleForwardingChange("busy", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">On No Answer</Label>
                    <Input
                      placeholder="Extension to forward to"
                      className="bg-muted/50"
                      value={settings.forwarding.noAnswer || ""}
                      onChange={(e) => handleForwardingChange("noAnswer", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">On Unavailable</Label>
                    <Input
                      placeholder="Extension to forward to"
                      className="bg-muted/50"
                      value={settings.forwarding.unavailable || ""}
                      onChange={(e) => handleForwardingChange("unavailable", e.target.value)}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Block List */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Blocked Numbers
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-2">
                  {settings.blockedNumbers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No blocked numbers</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {settings.blockedNumbers.map((num) => (
                        <Badge
                          key={num}
                          variant="secondary"
                          className="cursor-pointer hover:bg-destructive/20"
                          onClick={() => handleUnblock(num)}
                        >
                          {num} ×
                        </Badge>
                      ))}
                    </div>
                  )}
                  <form
                    className="flex gap-2 mt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.querySelector("input") as HTMLInputElement;
                      const val = input.value.trim();
                      if (val) {
                        handleBlock(val);
                        input.value = "";
                      }
                    }}
                  >
                    <Input placeholder="Add number..." className="bg-muted/50 flex-1" />
                    <Button type="submit" size="sm" variant="secondary">Add</Button>
                  </form>
                </CardContent>
              </Card>

              {/* Recording */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Mic className="h-4 w-4" /> Call Recording
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="recording" className="text-sm">Record all calls</Label>
                    <Switch
                      id="recording"
                      checked={settings.recordingEnabled}
                      onCheckedChange={(v) => setSettings({ recordingEnabled: v })}
                    />
                  </div>
                  {settings.recordingEnabled && (
                    <p className="text-xs text-muted-foreground">
                      Recordings will be available in the admin panel
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Voicemail */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Voicemail className="h-4 w-4" /> Voicemail
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="voicemail" className="text-sm">Enable voicemail</Label>
                    <Switch
                      id="voicemail"
                      checked={settings.voicemailEnabled}
                      onCheckedChange={(v) => setSettings({ voicemailEnabled: v })}
                    />
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ─── PSTN Tab ───────────────────────────────────── */}
          {activeTab === "pstn" && (
            <>
              {/* PSTN Outbound: Browser → Phone */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Globe className="h-4 w-4" /> Browser → Phone
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Route calls to unavailable extensions to a mobile number via SIP trunk.
                  </p>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pstn" className="text-sm">Enable PSTN fallback</Label>
                    <Switch
                      id="pstn"
                      checked={settings.pstnEnabled}
                      onCheckedChange={(v) => setSettings({ pstnEnabled: v })}
                    />
                  </div>
                  {settings.pstnEnabled && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Mobile for PSTN routing</Label>
                      <PhoneInput
                        value={settings.pstnMobile || ""}
                        countryCode={settings.pstnCountryCode || "+91"}
                        onValueChange={(v) => setSettings({ pstnMobile: v })}
                        onCountryCodeChange={(v) => setSettings({ pstnCountryCode: v })}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* PSTN Inbound: Phone → Browser */}
              <Card className="border-border/50 bg-card/50">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Phone className="h-4 w-4" /> Phone → Browser
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Forward incoming calls from your phone number to any extension or IVR.
                  </p>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="pstn-fwd" className="text-sm">Forward phone calls</Label>
                    <Switch
                      id="pstn-fwd"
                      checked={settings.pstnForwardToBrowser}
                      onCheckedChange={(v) => { setSettings({ pstnForwardToBrowser: v }); savePstnForward(v, settings.pstnForwardTarget); }}
                    />
                  </div>
                  {settings.pstnForwardToBrowser && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Your phone number (DID)</Label>
                        <PhoneInput
                          value={settings.pstnMobile || ""}
                          countryCode={settings.pstnCountryCode || "+91"}
                          onValueChange={(v) => setSettings({ pstnMobile: v })}
                          onCountryCodeChange={(v) => setSettings({ pstnCountryCode: v })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Forward to (extension or IVR)</Label>
                        <Input
                          placeholder={user?.extension || "1001"}
                          value={settings.pstnForwardTarget || ""}
                          onChange={(e) => {
                            const target = e.target.value;
                            setSettings({ pstnForwardTarget: target });
                            savePstnForward(settings.pstnForwardToBrowser, target);
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Leave empty to ring your browser. Enter 5000 for IVR, or another extension like 1002.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}

        </div>
      </ScrollArea>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              This will permanently delete your account ({user?.extension}). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-2">
            <Button variant="secondary" size="sm" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteAccount}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
