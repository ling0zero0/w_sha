import { networkInterfaces } from "node:os";

const virtualInterfacePattern = /virtual|vmware|vethernet|hyper-v|loopback|docker|wsl|bluetooth|tailscale|zerotier/i;

interface AddressCandidate {
  address: string;
  interfaceName: string;
  score: number;
}

function addressScore(interfaceName: string, address: string): number {
  let score = 0;
  if (/^(ethernet|以太网|wi-?fi|wlan)/i.test(interfaceName)) score += 20;
  if (/^192\.168\./.test(address)) score += 5;
  if (/^10\./.test(address)) score += 4;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 3;
  if (virtualInterfacePattern.test(interfaceName)) score -= 30;
  return score;
}

export function selectLanAddress(
  interfaces: NodeJS.Dict<ReturnType<typeof networkInterfaces>[string]> = networkInterfaces()
): string {
  const candidates: AddressCandidate[] = [];

  for (const [interfaceName, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      candidates.push({
        address: entry.address,
        interfaceName,
        score: addressScore(interfaceName, entry.address)
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.interfaceName.localeCompare(right.interfaceName));
  return candidates[0]?.address ?? "127.0.0.1";
}
