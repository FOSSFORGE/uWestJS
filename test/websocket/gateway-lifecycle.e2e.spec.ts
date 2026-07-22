import 'reflect-metadata';
import { UwsAdapter } from '../../src/websocket/adapter/uws.adapter';
import { UwsSocket, SocketHandshake } from '../../src/websocket/interfaces';
import { ParamType, PARAM_ARGS_METADATA } from '../../src/websocket/decorators';

const MESSAGE_MAPPING_METADATA = 'websockets:message_mapping';
const MESSAGE_METADATA = 'message';

function addMessageMetadata(target: object, event: string): void {
  Reflect.defineMetadata(MESSAGE_MAPPING_METADATA, true, target);
  Reflect.defineMetadata(MESSAGE_METADATA, event, target);
}

function addParamMetadata(
  target: object,
  methodName: string,
  params: Array<{ index: number; type: ParamType }>
): void {
  Reflect.defineMetadata(PARAM_ARGS_METADATA, params, target, methodName);
}

type TestSocketData = { label?: string };

/**
 * Gateway following the Lifecycle.md examples: handleConnection uses the
 * UwsSocket API (emit, data, handshake) and message handlers receive the
 * connected socket via parameter metadata.
 */
class LifecycleGateway {
  connectionClients: UwsSocket<TestSocketData>[] = [];
  disconnectClients: UwsSocket<TestSocketData>[] = [];
  handlerClients: UwsSocket<TestSocketData>[] = [];
  handshakes: Array<SocketHandshake | undefined> = [];

  handleConnection(client: UwsSocket<TestSocketData>) {
    this.connectionClients.push(client);
    this.handshakes.push(client.handshake);
    client.data = { label: 'set-in-connection-hook' };
    client.emit('welcome', { message: 'Hello!' });
  }

  handleDisconnect(client: UwsSocket<TestSocketData>) {
    this.disconnectClients.push(client);
  }

  handleWhoami(client: UwsSocket<TestSocketData>) {
    this.handlerClients.push(client);
    return { label: client.data?.label ?? null };
  }
}

addMessageMetadata(LifecycleGateway.prototype.handleWhoami, 'whoami');
addParamMetadata(LifecycleGateway.prototype, 'handleWhoami', [
  { index: 0, type: ParamType.CONNECTED_SOCKET },
]);

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error(`failed to connect to ${url}`)));
  });
}

function nextMessage(ws: WebSocket): Promise<{ event: string; data?: unknown }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for message')), 5000);
    ws.addEventListener(
      'message',
      (event) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(event.data)));
      },
      { once: true }
    );
  });
}

function closed(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.addEventListener('close', () => resolve(), { once: true });
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Gateway lifecycle E2E', () => {
  const port = 13390;
  let adapter: UwsAdapter;
  let gateway: LifecycleGateway;

  beforeEach(async () => {
    gateway = new LifecycleGateway();
    adapter = new UwsAdapter(null, { port });
    await adapter.create(port);
    adapter.registerGateway(gateway);
    adapter.bindClientConnect(null as never, () => undefined);
    await waitFor(() => adapter.getClientCount() === 0);
  });

  afterEach(() => {
    adapter?.dispose();
  });

  it('exposes the upgrade request on client.handshake', async () => {
    const ws = await connect(`ws://localhost:${port}/chat?token=abc&room=42&room=43`);
    await nextMessage(ws); // welcome

    expect(gateway.handshakes).toHaveLength(1);
    const handshake = gateway.handshakes[0];
    expect(handshake).toBeDefined();
    expect(handshake!.url).toBe('/chat');
    expect(handshake!.query).toEqual({ token: 'abc', room: '42' });
    expect(handshake!.headers['host']).toBe(`localhost:${port}`);
    expect(handshake!.headers['upgrade']).toBe('websocket');
    expect(handshake!.address.length).toBeGreaterThan(0);

    ws.close();
    await closed(ws);
  });

  it('passes the wrapped socket to handleConnection so the UwsSocket API works', async () => {
    const ws = await connect(`ws://localhost:${port}/`);

    // handleConnection calls client.emit('welcome') - with the raw uWS socket
    // this would throw because emit() does not exist there
    const welcome = await nextMessage(ws);
    expect(welcome).toEqual({ event: 'welcome', data: { message: 'Hello!' } });

    ws.close();
    await closed(ws);
  });

  it('gives lifecycle hooks and message handlers the same socket instance', async () => {
    const ws = await connect(`ws://localhost:${port}/`);
    await nextMessage(ws); // welcome

    ws.send(JSON.stringify({ event: 'whoami' }));
    const reply = await nextMessage(ws);

    // data attached in handleConnection is visible to the message handler
    expect(reply).toEqual({ event: 'whoami', data: { label: 'set-in-connection-hook' } });
    expect(gateway.handlerClients[0]).toBe(gateway.connectionClients[0]);

    ws.close();
    await closed(ws);
    await waitFor(() => gateway.disconnectClients.length === 1);
    expect(gateway.disconnectClients[0]).toBe(gateway.connectionClients[0]);
  });
});
