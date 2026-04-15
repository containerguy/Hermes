import type { Response } from "express";

const clients = new Set<Response>();

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
  clients.add(response);
  send(response, "connected", { at: new Date().toISOString() });

  return () => {
    clients.delete(response);
  };
}

export function broadcastEventsChanged(reason: string) {
  const payload = {
    reason,
    at: new Date().toISOString()
  };

  for (const client of clients) {
    send(client, "events_changed", payload);
  }
}
