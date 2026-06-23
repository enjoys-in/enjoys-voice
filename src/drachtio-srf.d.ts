/**
 * Local module augmentation for `drachtio-srf`.
 *
 * The package's shipped types only declare the `invite` request handler on the
 * `Srf` class, but drachtio-srf installs a handler-registration method for every
 * SIP method at runtime (`srf.register`, `srf.options`, `srf.info`,
 * `srf.message`, …). Declare the ones this codebase actually uses so the SIP
 * handlers can be strongly typed with `Srf.SrfRequest` / `Srf.SrfResponse`
 * instead of `any`.
 *
 * NOTE: this file MUST be a module (hence the side-effect import) so the
 * `declare module` block below *augments* the upstream class rather than
 * replacing the module.
 */
import 'drachtio-srf';

declare module 'drachtio-srf' {
  interface Srf {
    register(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
    options(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
    info(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
    message(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
    notify(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
    subscribe(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
    update(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
    refer(callback: (req: Srf.SrfRequest, res: Srf.SrfResponse) => void): void;
  }
}
