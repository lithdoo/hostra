import type { IConnection } from 'vscode-ws-jsonrpc/server';
import type { Message } from 'vscode-jsonrpc';

/**
 * Like `forward()` from vscode-ws-jsonrpc but uses a different mapper for each direction
 * (needed to rewrite `file:///workspace` ↔ temp dir without breaking JSON-RPC responses).
 */
export function asymmetricForward(
  clientConnection: IConnection,
  serverConnection: IConnection,
  clientToServer: (message: Message) => Message,
  serverToClient: (message: Message) => Message,
): void {
  clientConnection.forward(serverConnection, clientToServer);
  serverConnection.forward(clientConnection, serverToClient);
  clientConnection.onClose(() => serverConnection.dispose());
  serverConnection.onClose(() => clientConnection.dispose());
}
