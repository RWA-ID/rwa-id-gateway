# rwa-id-gateway

> EIP-3668 CCIP-Read Gateway for RWA ID Identity Resolution

[![Website](https://img.shields.io/badge/Website-rwa--id.com-00BCD4?style=flat-square)](https://rwa-id.com)
[![Standard](https://img.shields.io/badge/Standard-EIP--3668-00BCD4?style=flat-square)](https://eips.ethereum.org/EIPS/eip-3668)
[![Network](https://img.shields.io/badge/Network-Ethereum%20Mainnet-success?style=flat-square)](https://ethereum.org/)
[![Status](https://img.shields.io/badge/Status-Live-success?style=flat-square)](https://rwa-id.com)

The **RWA ID Gateway** is the off-chain CCIP-Read server that powers identity resolution for all `*.rwa-id.eth` subdomains. It implements [EIP-3668](https://eips.ethereum.org/EIPS/eip-3668) to enable gas-efficient, verifiable off-chain lookups backed by on-chain signature verification.

---

## 🔍 What Is This?

When a wallet resolves a name like `joe.test.rwa-id.eth`, the on-chain ENS Wildcard Resolver triggers a CCIP-Read callback to this gateway. The gateway looks up the identity on-chain, signs a response payload, and returns it — the resolver then verifies the signature on-chain.

```
Wallet resolves: joe.test.rwa-id.eth
        ↓
ENS Registry → Wildcard Resolver (0x765FB675AC33a85ccb455d4cb0b5Fb1f2D345eb1)
        ↓ CCIP-Read (EIP-3668)
rwa-id-gateway (this repo)
        ↓ Returns: signed (node, address, messageHash, sig)
resolveWithProof() verifies signature on-chain
        ↓
Wallet displays: ✓ joe.test.rwa-id.eth
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│           On-Chain (Ethereum Mainnet)        │
│                                             │
│  ENS Wildcard Resolver                      │
│  0x765FB675AC33a85ccb455d4cb0b5Fb1f2D345eb1 │
│  ┌─────────────────────────────────────┐    │
│  │  resolve() → OffchainLookup revert  │    │
│  │  resolveWithProof() → verify sig    │    │
│  └─────────────────────────────────────┘    │
└──────────────────┬──────────────────────────┘
                   │ EIP-3668 CCIP-Read
                   ↓
┌─────────────────────────────────────────────┐
│              rwa-id-gateway                 │
│                                             │
│  GET /{sender}/{calldata}.json              │
│  ┌─────────────────────────────────────┐    │
│  │  1. Decode DNS-encoded name         │    │
│  │  2. Call projectIdBySlugHash()      │    │
│  │  3. Call nameNodeFromHash()         │    │
│  │  4. Call resolveAddr(node)          │    │
│  │  5. Sign response payload           │    │
│  │  6. Return ABI-encoded result       │    │
│  └─────────────────────────────────────┘    │
└──────────────────┬──────────────────────────┘
                   │
┌─────────────────────────────────────────────┐
│     RWAIDv2 Core Contract (Ethereum)        │
│  0xD0B565C7134bDB16Fc3b8A9Cb5fdA003C37930c2 │
│  (namespaces, identity NFTs, resolveAddr)   │
└─────────────────────────────────────────────┘
```

---

## 📡 Gateway Endpoint

```
GET /{sender}/{calldata}.json
```

| Parameter  | Description |
|------------|-------------|
| `sender`   | Address of the ENS resolver contract (lowercase hex, no `0x` prefix) |
| `calldata` | Hex-encoded `abi.encode(bytes dnsName, bytes addrCalldata)` from `OffchainLookup` (no `0x` prefix) |

**Live Gateway URL:**
```
https://gateway.rwa-id.com/{sender}/{data}.json
```

**Response:**
```json
{ "data": "0x<abi.encode(bytes32 node, address resolved, bytes32 messageHash, bytes sig)>" }
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js v18+
- npm
- Ethereum mainnet RPC endpoint (Infura, Alchemy, etc.)

### Installation

```bash
git clone https://github.com/RWA-ID/rwa-id-gateway.git
cd rwa-id-gateway
npm install
cp .env.example .env   # fill in your keys
```

### Configuration

```env
ETH_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY
GATEWAY_SIGNER_PRIVATE_KEY=your_private_key_here
RWA_ID_REGISTRY=0xD0B565C7134bDB16Fc3b8A9Cb5fdA003C37930c2
PORT=5000
```

> The `GATEWAY_SIGNER_PRIVATE_KEY` must correspond to the `trustedSigner` address registered in the on-chain resolver. Any response signed by a different key will be rejected.

### Run

```bash
node index.js
```

---

## 🔄 Resolution Flow (Detailed)

1. **Wallet queries ENS** for `joe.test.rwa-id.eth`
2. **ENS Registry** routes to the RWA ID Wildcard Resolver (`0x765F...eb1`)
3. **Resolver reverts** with `OffchainLookup(gateway_url, sender, calldata, resolveWithProof, extraData)`
4. **Wallet calls gateway** at `GET /{sender}/{calldata}.json`
5. **Gateway decodes** the DNS-encoded name from calldata
6. **Gateway calls** `projectIdBySlugHash(slugHash)` → project ID
7. **Gateway calls** `nameNodeFromHash(projectId, nameHash)` → ENS node
8. **Gateway calls** `resolveAddr(node)` → resolved address (owner of the identity NFT)
9. **Gateway signs** `keccak256(abi.encodePacked(registry, node, address))` with the trusted signer key
10. **Gateway returns** `{ data: abi.encode(node, address, messageHash, sig) }`
11. **Wallet calls** `resolveWithProof(response, extraData)` on the resolver
12. **Resolver verifies** the signature against `trustedSigner` on-chain
13. **Wallet displays** the resolved address ✓

---

## 📋 Deployed Contracts (Ethereum Mainnet)

| Contract | Address |
|----------|---------|
| **RWAIDv2** | [`0xD0B565C7134bDB16Fc3b8A9Cb5fdA003C37930c2`](https://etherscan.io/address/0xD0B565C7134bDB16Fc3b8A9Cb5fdA003C37930c2) |
| **ENS Wildcard Resolver v2** | [`0x765FB675AC33a85ccb455d4cb0b5Fb1f2D345eb1`](https://etherscan.io/address/0x765FB675AC33a85ccb455d4cb0b5Fb1f2D345eb1) |

---

## 🧪 Testing Resolution

Verify the gateway is working by resolving this live identity in any ENS-compatible wallet:

```
joe.test.rwa-id.eth
```

Supported wallets: MetaMask, Trust Wallet, Rainbow, Uniswap Wallet, and any ENS-compatible wallet.

Or test the endpoint directly:

```bash
curl https://gateway.rwa-id.com/health
```

---

## 📁 Project Structure

```
rwa-id-gateway/
├── index.js        # Gateway server — CCIP-Read endpoint + resolution logic
├── package.json
├── .env.example
└── README.md
```

---

## 🔒 Security

- The gateway **signs all responses** with a private key. The corresponding address is set as `trustedSigner` in the on-chain resolver — any tampered response will fail signature verification.
- The gateway is **stateless** — it reads live data from the RWAIDv2 contract and stores nothing locally.
- Never expose your `GATEWAY_SIGNER_PRIVATE_KEY`. It does not hold funds but must be kept secret to prevent spoofed resolution responses.

---

## 🔗 Related Repositories

| Repo | Description |
|------|-------------|
| [RWA-ID/RWA-ID](https://github.com/RWA-ID/RWA-ID) | Core smart contracts, scripts, and documentation |
| [RWA-ID/rwa-id-frontend](https://github.com/RWA-ID/rwa-id-frontend) | Platform console and client claim portal |
| **rwa-id-gateway** (this repo) | EIP-3668 CCIP-Read gateway |

---

## 📚 References

- [EIP-3668: CCIP-Read — Secure offchain data retrieval](https://eips.ethereum.org/EIPS/eip-3668)
- [ENS Wildcard Resolution (ENSIP-10)](https://docs.ens.domains/ensip/10)
- [RWA ID Technical Overview](https://www.notion.so/RWA-ID-Technical-Overview-Reference-Implementation-2f775dbae2778094a03fd6b967edbdfa)
- [RWA ID Whitepaper](https://github.com/RWA-ID/RWA-ID/blob/main/whitepaper.md)

---

## 📞 Contact

**Website:** [rwa-id.com](https://rwa-id.com)
**Email:** [partner@rwa-id.com](mailto:partner@rwa-id.com)
**Founder:** Hector Morel

---

## 📄 License

MIT

---

**RWA ID** — Identity Infrastructure for the Tokenized Economy

[Website](https://rwa-id.com) • [Whitepaper](https://github.com/RWA-ID/RWA-ID/blob/main/whitepaper.md) • [Technical Docs](https://www.notion.so/RWA-ID-Technical-Overview-Reference-Implementation-2f775dbae2778094a03fd6b967edbdfa) • [Contact](mailto:partner@rwa-id.com)
