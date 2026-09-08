/**
 * The test-side fake extension.
 *
 * The client itself lives in `src/fake-extension.ts` because `lit serve --fake`
 * ships it: the demo mode and the test suite drive the bridge through one
 * implementation. Only the test-only helper below lives here.
 */
import { WebSocket } from 'ws';
import {
  FakeActionError,
  FakeExtensionClient,
  type FakeExtensionOptions,
  type FakeHandler,
  type FakeHandlers,
} from '../src/fake-extension.js';

export type Handler = FakeHandler;
export type Handlers = FakeHandlers;
export type { FakeExtensionOptions };

/** Thrown from a handler to make the fake extension answer with an error envelope. */
export const FakeError = FakeActionError;

export class FakeExtension extends FakeExtensionClient {
  /** Connect expecting the server to reject the token; resolves with the close code. */
  static async expectRejected(options: FakeExtensionOptions): Promise<number> {
    const host = options.host ?? '127.0.0.1';
    const ws = new WebSocket(`ws://${host}:${options.port}`);
    return await new Promise<number>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(
          JSON.stringify({
            type: 'hello',
            token: options.token,
            extensionVersion: options.extensionVersion ?? '2.0.0',
          }),
        );
      });
      ws.once('close', (code) => resolve(code));
      ws.once('error', reject);
    });
  }
}
