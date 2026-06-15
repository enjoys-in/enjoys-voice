// Single, consistent JSON envelope for every Node (/api/n) HTTP handler,
// mirroring the Go API's response package: { success, message, data }.
//
//   success — true for 2xx outcomes, false for errors
//   message — short human-readable status ("OK", "Created", or an error reason)
//   data    — the payload (object, array, or null on errors)
import { Response } from 'express';

export interface Envelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

/** 200 with data and a generic (or custom) message. */
export function ok<T>(res: Response, data: T, message = 'OK'): void {
  res.status(200).json({ success: true, message, data } satisfies Envelope<T>);
}

/** 201 with data and a generic (or custom) message. */
export function created<T>(res: Response, data: T, message = 'Created'): void {
  res.status(201).json({ success: true, message, data } satisfies Envelope<T>);
}

/** Arbitrary status with success=false and a null payload. */
export function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, message, data: null } satisfies Envelope<null>);
}
