# rwa-id-gateway

> EIP-3668 CCIP-Read Gateway for RWA ID Identity Resolution

[![Website](https://img.shields.io/badge/Website-rwa--id.com-00BCD4?style=flat-square)](https://rwa-id.com)
[![Standard](https://img.shields.io/badge/Standard-EIP--3668-00BCD4?style=flat-square)](https://eips.ethereum.org/EIPS/eip-3668)
[![Network](https://img.shields.io/badge/Network-Linea%20Mainnet-success?style=flat-square)](https://linea.build/)
[![Status](https://img.shields.io/badge/Status-Live-success?style=flat-square)](https://rwa-id.com)

The **RWA ID Gateway** is the off-chain CCIP-Read server that powers identity resolution for all `*.rwa-id.eth` subdomains. It implements [EIP-3668](https://eips.ethereum.org/EIPS/eip-3668) to enable gas-efficient, verifiable off-chain lookups with on-chain Merkle proof verification.

---

## 🔍 What Is This?

When a wallet resolves a name like `alice.securitize.rwa-id.eth`, the on-chain ENS Wildcard Resolver triggers a CCIP-Read callback to this gateway. The gateway responds with a signed payload containing the resolved address and a Merkle proof — which the resolver then verifies on-chain.

```
Wallet resolves: alice.securitize.rwa-id.eth
        ↓
ENS Registry → Wildcard Resolver (0x188a...c80)
        ↓ CCIP-Read (EIP-3668)
rwa-id-gateway (this repo)
        ↓ Returns: signed payload + Merkle proof
Resolver verifies on-chain
        ↓
Wallet displays: ✓ alice.securitize.rwa-id.eth
```

---

## 🏗️ Architecture

The gateway sits between the on-chain resolver and off-chain identity data:

```
┌─────────────────────────────────────────────┐
│              On-Chain (Linea)               │
│                                             │
│  ENS Wildcard Resolver (0x188a...c80)       │
│  ┌─────────────────────────────────────┐    │
│  │  resolve() → OffchainLookup revert  │    │
│  │  callback() → verify Merkle proof   │    │
│  └─────────────────────────────────────┘    │
└──────────────────┬──────────────────────────┘
                   │ EIP-3668 CCIP-Read
                   ↓
┌─────────────────────────────────────────────┐
│              rwa-id-gateway                 │
│                                             │
│  GET /{sender}/{calldata}.json              │
│  ┌─────────────────────────────────────┐    │
│  │  1. Decode ENS calldata             │    │
│  │  2. Lookup platform + client data   │    │
│  │  3. Generate Merkle proof           │    │
│  │  4. Sign response payload           │    │
│  │  5. Return ABI-encoded result       │    │
│  └─────────────────────────────────────┘    │
└──────────────────┬──────────────────────────┘
                   │
┌─────────────────────────────────────────────┐
│        RWA ID Core Contract (Linea)         │
│  0x74aaCeff8139c84433befB922a8E687B6ba51F3a │
│  (Merkle roots, platform namespaces,        │
│   claimed identities)                       │
└─────────────────────────────────────────────┘
```

---

## 📡 Gateway Endpoint

```
GET /{sender}/{calldata}.json
```

| Parameter | Description |
|-----------|-------------|
| `sender`  | Address of the ENS resolver contract making the request |
| `calldata`| ABI-encoded calldata from the `OffchainLookup` revert |

**Live Gateway URL:**
```
https://rwaid-gatewayzip--nftworldeth.replit.app/{sender}/{data}.json
```

---

## 🚀 Quick Start

### Prerequisites

- Node.js v18+
- npm or yarn
- Access to a Linea RPC endpoint

### Installation

```bash
git clone https://github.com/RWA-ID/rwa-id-gateway.git
cd rwa-id-gateway
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
# Required
PRIVATE_KEY=0x...          # Signer private key (must match resolver's trusted signer)
RPC_URL=https://...        # Linea mainnet RPC (e.g., Infura, Alchemy)
PORT=3000                  # Gateway port (default: 3000)

# Contract Addresses (Linea Mainnet)
CORE_CONTRACT=0x74aaCeff8139c84433befB922a8E687B6ba51F3a
RESOLVER_CONTRACT=0x188a60a8bC5Df96CD12C64FBAf166075a5029c80
```

### Run the Gateway

```bash
# Development
node index.js

# Production (with pm2)
pm2 start index.js --name rwa-id-gateway
```

---

## 🔄 Resolution Flow (Detailed)

1. **Wallet queries ENS** for `alice.securitize.rwa-id.eth`
2. **ENS Registry** routes to the RWA ID Wildcard Resolver (`0x188a...c80`)
3. **Resolver reverts** with `OffchainLookup(gateway_url, sender, calldata, callback_selector, extra_data)`
4. **Wallet calls gateway** at `GET /{sender}/{calldata}.json`
5. **Gateway decodes** the calldata to extract the subdomain being resolved
6. **Gateway queries** the RWA ID Core Contract for the platform's Merkle root and the client's address
7. **Gateway generates** a Merkle proof for the client's entry
8. **Gateway signs** the response with its private key
9. **Gateway returns** ABI-encoded `(address resolvedAddress, bytes memory proof, bytes memory sig)`
10. **Wallet calls** the resolver's `callback()` function with the gateway response
11. **Resolver verifies** the Merkle proof and signature on-chain
12. **Wallet displays** the resolved address ✓

---

## 📁 Project Structure

```
rwa-id-gateway/
├── index.js              # Main gateway server + request handler
├── rwaid-gateway/        # Core gateway logic
│   ├── resolver.js       # ENS calldata decoding + response encoding
│   ├── merkle.js         # Merkle proof generation
│   └── signer.js         # Response signing
├── package.json
├── .gitignore
└── README.md
```

---

## 📦 Key Dependencies

| Package | Purpose |
|---------|---------|
| `ethers` | ABI encoding/decoding, signing, contract calls |
| `express` | HTTP server for CCIP-Read endpoint |
| `@ensdomains/ens-contracts` | ENS ABI and utilities |
| `merkletreejs` | Merkle tree generation and proof creation |

---

## 🔗 Related Repositories

| Repo | Description |
|------|-------------|
| [RWA-ID/RWA-ID](https://github.com/RWA-ID/RWA-ID) | Core smart contracts, whitepaper, and documentation |
| [RWA-ID/rwa-id-frontend](https://github.com/RWA-ID/rwa-id-frontend) | Platform dashboard and client claim portal |
| **rwa-id-gateway** (this repo) | EIP-3668 CCIP-Read gateway |

---

## 📋 Deployed Contracts (Linea Mainnet)

| Contract | Address | Purpose |
|----------|---------|---------|
| **Core Contract** | [`0x74aaCeff8139c84433befB922a8E687B6ba51F3a`](https://lineascan.build/address/0x74aaCeff8139c84433befB922a8E687B6ba51F3a) | Project namespaces, Merkle roots, identity claims |
| **ENS Wildcard Resolver** | [`0x188a60a8bC5Df96CD12C64FBAf166075a5029c80`](https://lineascan.build/address/0x188a60a8bC5Df96CD12C64FBAf166075a5029c80) | EIP-3668 CCIP-Read resolver |

---

## 🧪 Testing Resolution

You can verify the gateway is working by resolving the live test identity in any ENS-compatible wallet:

```
joe.test.rwa-id.eth
```

Supported wallets: MetaMask, Trust Wallet, Rainbow, Uniswap Wallet, and any ENS-compatible wallet.

---

## 🔒 Security Considerations

- The gateway **signs all responses** with a private key. The corresponding public key is registered in the on-chain resolver — any tampered response will fail on-chain verification.
- The gateway is **stateless** — it reads data from the on-chain Core Contract and never stores identity data locally.
- **Merkle proofs** ensure clients can only claim identities that were committed to the on-chain root by the platform.
- Never expose your `PRIVATE_KEY` — this is the signer key, not a wallet with funds, but it must be kept secret to prevent spoofed responses.

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
