// Minimal ambient declarations for the `wav` package (no official @types).
declare module 'wav' {
  import { Writable } from 'node:stream';

  interface FileWriterOptions {
    channels?: number;
    sampleRate?: number;
    bitDepth?: number;
  }

  export class FileWriter extends Writable {
    constructor(path: string, options?: FileWriterOptions);
  }

  export class Reader extends Writable {}
  export class Writer extends Writable {
    constructor(options?: FileWriterOptions);
  }
}
