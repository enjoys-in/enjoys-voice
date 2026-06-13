/**
 * Ambient type shim for `@enjoys/exception` (v1.1.2).
 *
 * The published package.json maps `exports["."].types` to `./dist/index.d.ts`,
 * but that file is missing from the tarball (the real declarations ship at
 * `esm/index.d.ts` / `cjs/index.d.ts`). Under this project's "bundler" module
 * resolution TypeScript follows the exports map and so fails to find any types.
 * This shim restores the public surface we use. Runtime is unaffected — bun
 * loads the real `esm/index.js`.
 */
declare module '@enjoys/exception' {
  import type { Request, Response, NextFunction } from 'express';

  export type HttpStatusName =
    | 'BAD_REQUEST'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'METHOD_NOT_ALLOWED'
    | 'CONFLICT'
    | 'PAYLOAD_TOO_LARGE'
    | 'TOO_MANY_REQUESTS'
    | 'INTERNAL_SERVER_ERROR'
    | 'BAD_GATEWAY'
    | 'NOT_IMPLEMENTED'
    // Any other key of the package's HttpStatusCodes map.
    | (string & {});

  export interface HttpExceptionParams {
    name: HttpStatusName;
    message: string;
    stack?: string | unknown;
  }

  export class HttpException extends Error {
    constructor(params: HttpExceptionParams);
    static TypeOfError(name: HttpStatusName): number;
  }

  /** 404 / catch-all middleware. Throws an HttpException (forwarded to ExceptionHandler). */
  type RouteMiddleware = (req: Request, res: Response, next: NextFunction) => void;
  /** Express error-handling middleware (4-arity). */
  type ErrorMiddleware = (err: Error, req: Request, res: Response, next: NextFunction) => void;

  export function createHandlers(): {
    UnhandledRoutes: RouteMiddleware;
    ExceptionHandler: ErrorMiddleware;
    CustomExceptionHandler: ErrorMiddleware;
  };

  export class ServerErrorException extends HttpException { constructor(params: { stack: unknown }); }
  export class NotFoundException extends HttpException { constructor(params: { stack: unknown }); }
  export class UnAuthorizedException extends HttpException { constructor(params: { stack: unknown }); }
  export class BadGatewayException extends HttpException { constructor(params: { stack: unknown }); }
  export class DuplicateEntryException extends HttpException { constructor(params: { stack: unknown }); }
  export class ForbiddenException extends HttpException { constructor(params: { stack: unknown }); }
  export class PayloadTooLargeException extends HttpException { constructor(params: { stack: unknown }); }
  export class TooManyRequestException extends HttpException { constructor(params: { stack: unknown }); }
  export class MethodNotAllowedException extends HttpException { constructor(params: { stack: unknown }); }
  export class UnacceptableException extends HttpException { constructor(params: { stack: unknown }); }
  export class NotImplementedException extends HttpException { constructor(params: { stack: unknown }); }
}
