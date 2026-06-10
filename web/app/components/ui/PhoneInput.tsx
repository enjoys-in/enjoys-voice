"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const COUNTRY_CODES = [
  { code: "+91", country: "IN", flag: "🇮🇳" },
  { code: "+1", country: "US", flag: "🇺🇸" },
  { code: "+44", country: "GB", flag: "🇬🇧" },
  { code: "+61", country: "AU", flag: "🇦🇺" },
  { code: "+971", country: "AE", flag: "🇦🇪" },
  { code: "+65", country: "SG", flag: "🇸🇬" },
  { code: "+49", country: "DE", flag: "🇩🇪" },
  { code: "+33", country: "FR", flag: "🇫🇷" },
  { code: "+81", country: "JP", flag: "🇯🇵" },
  { code: "+86", country: "CN", flag: "🇨🇳" },
];

interface PhoneInputProps {
  value: string;
  countryCode: string;
  onValueChange: (phone: string) => void;
  onCountryCodeChange: (code: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function PhoneInput({
  value,
  countryCode,
  onValueChange,
  onCountryCodeChange,
  placeholder = "9876543210",
  disabled,
}: PhoneInputProps) {
  return (
    <div className="flex gap-2">
      <Select value={countryCode} onValueChange={(v) => v && onCountryCodeChange(v)} disabled={disabled}>
        <SelectTrigger className="w-[90px] bg-muted/50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COUNTRY_CODES.map(({ code, country, flag }) => (
            <SelectItem key={code} value={code}>
              {flag} {code}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="tel"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, ""))}
        className="flex-1 bg-muted/50"
        disabled={disabled}
      />
    </div>
  );
}
