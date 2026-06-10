"use client";

import { useEffect } from "react";
import { LogOut, Shield, PhoneForwarded, Volume2, Voicemail, Music, Radio, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { PhoneInput } from "../ui/PhoneInput";
import { useAuthStore, useSettingsStore } from "../../stores";
import { useSettingsSync } from "../../hooks/useSettingsSync";

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
  const { saveForwarding, blockNumber, unblockNumber } = useSettingsSync();

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

      <ScrollArea className="flex-1 px-4 pb-4">
        <div className="space-y-4">
          {/* Profile */}
          <Card className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-lg font-bold">
                  {user?.name?.slice(0, 2).toUpperCase() || user?.extension}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{user?.name || user?.extension}</p>
                  <p className="text-sm text-muted-foreground">ext. {user?.extension}</p>
                  {user?.mobile && <p className="text-xs text-muted-foreground">{user.mobile}</p>}
                </div>
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
              <Separator className="opacity-50" />
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Music className="h-3 w-3" /> Caller Tune
                </Label>
                <Select
                  value={settings.callerTune}
                  onValueChange={(v) => v && setSettings({ callerTune: v })}
                >
                  <SelectTrigger className="bg-muted/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALLER_TUNES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Radio className="h-3 w-3" /> Ringtone
                </Label>
                <Select
                  value={settings.ringtone}
                  onValueChange={(v) => v && setSettings({ ringtone: v })}
                >
                  <SelectTrigger className="bg-muted/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RINGTONES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

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

          {/* PSTN Settings */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Radio className="h-4 w-4" /> PSTN Fallback
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
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

          <Separator />

          {/* Logout */}
          <Button
            variant="destructive"
            className="w-full"
            onClick={logout}
          >
            <LogOut className="h-4 w-4 mr-2" /> Sign Out
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
