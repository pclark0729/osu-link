/** Human-readable WebSocket close / failure messages for the party client. */
export function describePartyWsFailure(closeCode: number, reason: string, wsUrl: string): string {
  const trimmed = reason?.trim();
  const host = (() => {
    try {
      return new URL(wsUrl).host;
    } catch {
      return "";
    }
  })();

  if (closeCode === 1006) {
    return host
      ? `Could not reach ${host} (connection closed before handshake — often a firewall or home-router issue).`
      : "Could not reach party server (connection closed before handshake).";
  }
  if (closeCode === 1002) {
    return "Party server rejected the connection (protocol error).";
  }
  if (closeCode === 1003) {
    return trimmed || "Party server rejected the connection (invalid data).";
  }
  if (closeCode === 1008) {
    return trimmed || "Party server rejected the connection.";
  }
  if (closeCode === 1011) {
    return trimmed || "Party server error — try again later.";
  }
  if (closeCode === 1015) {
    return "TLS error while connecting — check certificates or HTTPS on the party host.";
  }
  if (trimmed) {
    return `Connection closed (${closeCode}): ${trimmed}`;
  }
  if (closeCode !== 1000 && closeCode !== 1001) {
    return `Connection closed unexpectedly (code ${closeCode}).`;
  }
  return "Could not connect to party server.";
}
