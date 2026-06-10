import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Extension or phone required"),
  password: z.string().min(1, "Password required"),
});

export const signupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  mobile: z.string().min(7, "Phone number must be at least 7 digits").regex(/^\d+$/, "Phone must be digits only"),
  password: z.string().min(4, "Password must be at least 4 characters"),
});

export const forwardingSchema = z.object({
  type: z.enum(["busy", "noAnswer", "unavailable"]),
  target: z.string().nullable(),
});

export const blockNumberSchema = z.object({
  number: z.string().min(1, "Number required").regex(/^[\d+*#]+$/, "Invalid number format"),
});

export const settingsSchema = z.object({
  callerTune: z.string(),
  ringtone: z.string(),
  soundsEnabled: z.boolean(),
  pstnEnabled: z.boolean(),
  pstnMobile: z.string().optional(),
  pstnCountryCode: z.string().optional(),
  recordingEnabled: z.boolean(),
  voicemailEnabled: z.boolean(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ForwardingInput = z.infer<typeof forwardingSchema>;
export type BlockNumberInput = z.infer<typeof blockNumberSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
