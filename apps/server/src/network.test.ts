import { describe, expect, it } from "vitest";
import { selectLanAddress } from "./network.js";

describe("LAN address selection", () => {
  it("prefers a physical private network over virtual adapters", () => {
    expect(selectLanAddress({
      "vEthernet (WSL)": [{
        address: "172.20.0.1",
        netmask: "255.255.240.0",
        family: "IPv4",
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "172.20.0.1/20"
      }],
      "Wi-Fi": [{
        address: "192.168.1.20",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:02",
        internal: false,
        cidr: "192.168.1.20/24"
      }]
    })).toBe("192.168.1.20");
  });

  it("falls back to loopback when no external IPv4 address exists", () => {
    expect(selectLanAddress({})).toBe("127.0.0.1");
  });
});
