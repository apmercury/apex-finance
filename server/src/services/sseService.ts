import { ServerResponse } from 'node:http';

interface ClientConnection {
  id: string;
  companyId: string;
  userId?: string;
  res: ServerResponse;
}

class SSEService {
  private clients: Map<string, ClientConnection> = new Map();

  public registerClient(id: string, companyId: string, userId: string | undefined, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ event: 'connected', clientId: id })}\n\n`);

    const connection: ClientConnection = { id, companyId, userId, res };
    this.clients.set(id, connection);

    // Heartbeat every 25 seconds
    const interval = setInterval(() => {
      if (this.clients.has(id)) {
        res.write(': heartbeat\n\n');
      } else {
        clearInterval(interval);
      }
    }, 25000);

    res.on('close', () => {
      clearInterval(interval);
      this.clients.delete(id);
    });
  }

  public broadcast(companyId: string, event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients.values()) {
      if (client.companyId === companyId) {
        try {
          client.res.write(payload);
        } catch {
          this.clients.delete(client.id);
        }
      }
    }
  }
}

export const sseService = new SSEService();
