# RWA-ID Gateway

## Overview

This project is an ENS CCIP-Read (EIP-3668) gateway for the RWA-ID project. It provides a Node.js/Express server that resolves ENS-style names (like `hector.securitize.rwa-id.eth`) by querying a registry contract on the Linea blockchain and returning signed responses that can be verified on-chain.

The gateway acts as an off-chain resolver, enabling gas-efficient name resolution by moving lookup logic off-chain while maintaining cryptographic verification through signed responses.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Server Framework
- **Technology**: Express.js (Node.js)
- **Rationale**: Lightweight HTTP server suitable for handling CCIP-Read requests with minimal overhead
- **Port**: Configurable via `PORT` environment variable, defaults to 8080

### Blockchain Integration
- **Library**: ethers.js v6
- **Network**: Linea (Ethereum L2)
- **Purpose**: Connects to Linea RPC to query the RWA-ID Registry contract for name resolution

### Core Endpoints
1. `GET /health` - Health check returning registry address
2. `GET /:sender/:data.json` - CCIP-Read callback endpoint for on-chain resolvers
3. `GET /resolve?name=...` - Developer-friendly name resolution endpoint

### Name Resolution Flow
1. Parse DNS wire format name from CCIP-Read request
2. Validate name ends with `.rwa-id.eth`
3. Extract label and slug components
4. Compute keccak256 hashes for slug and label
5. Query registry contract for project ID and node address
6. Sign response with gateway private key for on-chain verification

### Registry Contract Interface
The gateway interacts with a registry contract at the configured address using these functions:
- `projectIdBySlugHash(bytes32)` - Get project ID from slug hash
- `nameNodeFromHash(uint256, bytes32)` - Get name node from project ID and name hash
- `nodeAddr(bytes32)` - Get resolved address from node

### Response Signing
Responses are signed using a gateway private key to enable on-chain verification. The signature covers the registry address, node, and resolved address.

## External Dependencies

### Blockchain Services
- **Linea RPC** (`LINEA_RPC_URL`): JSON-RPC endpoint for Linea blockchain queries (default: `https://rpc.linea.build`)
- **RWA-ID Registry** (`RWA_ID_REGISTRY`): Smart contract address for name registry on Linea

### Required Environment Variables
| Variable | Description |
|----------|-------------|
| `LINEA_RPC_URL` | Linea blockchain RPC endpoint |
| `RWA_ID_REGISTRY` | Registry contract address on Linea |
| `GATEWAY_SIGNER_PRIVATE_KEY` | Private key for signing CCIP-Read responses |
| `PORT` | (Optional) Server port, defaults to 8080 |

### NPM Packages
- `express` - Web server framework
- `ethers` - Ethereum library for blockchain interactions and cryptographic operations
- `dotenv` - Environment variable management