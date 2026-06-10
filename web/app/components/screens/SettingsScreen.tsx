"use client";

import { LogOut, Shield, PhoneForwarded, Volume2, Voicemail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAuthStore, useSettingsStore } from "../../stores";

export function SettingsScreen() {
  const { user, logout } = useAuthStore();
  const { settings, setSettings, setForwarding, addBlockedNumber, removeBlockedNumber } = useSettingsStore();

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
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Audio */}
          <Card className="border-border/50 bg-card/50">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Volume2 className="h-4 w-4" /> Audio
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="sounds" className="text-sm">Enable sounds</Label>
                <Switch
                  id="sounds"
                  checked={settings.soundsEnabled}
                  onCheckedChange={(v) => setSettings({ soundsEnabled: v })}
                />
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
                  onChange={(e) => setForwarding("busy", e.target.value || undefined)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">On No Answer</Label>
                <Input
                  placeholder="Extension to forward to"
                  className="bg-muted/50"
                  value={settings.forwarding.noAnswer || ""}
                  onChange={(e) => setForwarding("noAnswer", e.target.value || undefined)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">On Unavailable</Label>
                <Input
                  placeholder="Extension to forward to"
                  className="bg-muted/50"
                  value={settings.forwarding.unavailable || ""}
                  onChange={(e) => setForwarding("unavailable", e.target.value || undefined)}
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
                      onClick={() => removeBlockedNumber(num)}
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
                  if (input.value.trim()) {
                    addBlockedNumber(input.value.trim());
                    input.value = "";
                  }
                }}
              >
                <Input placeholder="Add number..." className="bg-muted/50 flex-1" />
                <Button type="submit" size="sm" variant="secondary">Add</Button>
              </form>
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
