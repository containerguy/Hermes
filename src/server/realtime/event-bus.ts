import type { Response } from "express";

const clients = new Map<Response, ReturnType<typeof setInterval>>();

function send(response: Response, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerEventsClient(response: Response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  response.flushHeaders?.();
  response.write("retry: 15000\n\n");
  const heartbeat = setInterval(() => {
    send(response, "heartbeat", { at: new Date().toISOString() });
  }, 25_000);
  clients.set(response, heartbeat);
  send(response, "connected", { at: new Date().toISOString() });

  return () => {
    const existing = clients.get(response);
    if (existing) {
      clearInterval(existing);
    }
    clients.delete(response);
  };
}

export function broadcastEventsChanged(reason: string) {
  const payload = {
    reason,
    at: new Date().toISOString()
  };

  for (const client of clients.keys()) {
    send(client, "events_changed", payload);
  }
}
