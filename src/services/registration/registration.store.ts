import { SipRegistration } from '@/core';

export interface RegistrationStore {
  register(extension: string, data: SipRegistration): Promise<void>;
  unregister(extension: string): Promise<void>;
  get(extension: string): Promise<SipRegistration | undefined>;
  has(extension: string): Promise<boolean>;
  getAll(): Promise<Map<string, SipRegistration>>;
  close(): Promise<void>;
}
